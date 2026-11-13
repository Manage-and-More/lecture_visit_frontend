/**
 * Local mail bridge for the Lecture Visit outreach, using the TUM mailbox (LRZ Exchange)
 * instead of Gmail. Runs on the organiser's Mac; the TUM password never leaves it.
 *
 *   npm run -s mail:bridge              send what the tool queued, pick up replies, process them
 *   npm run -s mail:bridge -- --check   only test the IMAP and SMTP login
 *   npm run -s mail:bridge -- --dry-run show what would be sent and which replies were found
 *
 * Credentials: macOS Keychain entry "lecture-visit-tum-mail", account = TUM ID (e.g. ab12cde),
 * created once with:  security add-generic-password -s lecture-visit-tum-mail -a <TUM ID> -w
 * Supabase: SUPABASE_URL / SUPABASE_SERVICE_KEY from ../tum_scraper/.env (see load-env.ts).
 *
 * What it does per run, like the former Apps Script bridge:
 *   1. leases queued emails (sending mode, daily cap and test mode apply as before),
 *   2. sends them over SMTP (postout.lrz.de) and files a copy in Sent Items,
 *   3. reads new INBOX mail over IMAP (xmail.mwn.de) and keeps only replies to our own
 *      emails (In-Reply-To / References) and bounces; nothing else is passed on,
 *   4. records results and replies, flags/classifies replies, queues reminders.
 * Threads are tracked by RFC Message-IDs, stored in the gmail_message_id / gmail_thread_id
 * columns (named after the earlier Gmail bridge).
 */
import './load-env'
import '../outreach/env'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getSettings, leaseOutbox, processInbound, queueFollowups, recordSent, storeInbound,
  type InboundItem, type SentResult,
} from '@/lib/outreach/engine'

const KEYCHAIN_SERVICE = 'lecture-visit-tum-mail'
const IMAP_HOST = 'xmail.mwn.de'
const SMTP_HOST = 'postout.lrz.de'
const STATE_FILE = path.join(os.homedir(), '.config', 'lecture-visit', 'mail-bridge.json')
const OVERLAP_MS = 15 * 60_000
const FIRST_RUN_LOOKBACK_MS = 3 * 86400_000

const args = new Set(process.argv.slice(2))
const checkOnly = args.has('--check')
const dryRun = args.has('--dry-run')

function keychainCredentials(): { user: string; pass: string } {
  try {
    const quiet = { encoding: 'utf8' as const, stdio: ['ignore', 'pipe', 'ignore'] as ('ignore' | 'pipe')[] }
    const attrs = execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE], quiet)
    const user = attrs.match(/"acct"<blob>="([^"]+)"/)?.[1]
    const pass = execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], quiet).trim()
    if (!user || !pass) throw new Error('incomplete')
    return { user, pass }
  } catch {
    throw new Error(`No TUM login in the Keychain. Add it once with:\n  security add-generic-password -s ${KEYCHAIN_SERVICE} -a <TUM ID> -w`)
  }
}

function readState(): { lastInboundCheck?: string } {
  try { return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {} } catch { return {} }
}
function writeState(state: { lastInboundCheck: string }) {
  mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

const bracket = (id: string) => (id.startsWith('<') ? id : `<${id}>`)

async function main() {
  const { user, pass } = keychainCredentials()
  const db = createAdminClient()
  const settings = await getSettings(db)
  const from = settings.sender_email
  const domain = from.split('@')[1] ?? 'tum.de'

  const imap = new ImapFlow({ host: IMAP_HOST, port: 993, secure: true, auth: { user, pass }, logger: false })
  const smtp = nodemailer.createTransport({ host: SMTP_HOST, port: 587, secure: false, requireTLS: true, auth: { user, pass } })
  await imap.connect()
  await smtp.verify()
  console.log(`Logged in to ${IMAP_HOST} and ${SMTP_HOST} as ${user}; sending as ${from} (mode: ${settings.mode})`)
  if (checkOnly) {
    await imap.logout()
    return
  }

  try {
    // 1-2. Send what the tool queued
    const sent: SentResult[] = []
    if (dryRun) {
      const { count } = await db.from('email_messages').select('id', { count: 'exact', head: true })
        .eq('direction', 'outbound').eq('status', 'queued')
      console.log(`Dry run: ${count ?? 0} emails queued; mode ${settings.mode}; nothing sent.`)
    } else {
      const { outbox, blocked } = await leaseOutbox(db, settings)
      blocked.forEach(b => console.log(`Blocked: ${b}`))
      const sentFolder = (await imap.list()).find(f => f.specialUse === '\\Sent')?.path ?? 'Sent Items'
      for (const item of outbox) {
        try {
          const { data: row } = await db.from('email_messages').select('outreach_id').eq('id', item.id).single()
          // Thread headers: answer the lecturer's email, or a reminder answers our first email
          let inReplyTo = item.replyToGmailMessageId
          if (!inReplyTo && row) {
            const { data: first } = await db.from('email_messages').select('gmail_message_id')
              .eq('outreach_id', row.outreach_id).eq('direction', 'outbound').eq('status', 'sent')
              .not('gmail_message_id', 'is', null).order('sent_at').limit(1).maybeSingle()
            inReplyTo = (first?.gmail_message_id as string | undefined) ?? null
          }
          let threadKey: string | null = null
          if (inReplyTo) {
            const { data: parent } = await db.from('email_messages').select('gmail_thread_id')
              .eq('gmail_message_id', inReplyTo).limit(1).maybeSingle()
            threadKey = (parent?.gmail_thread_id as string | undefined) ?? inReplyTo
          }
          const messageId = `<${randomUUID()}@${domain}>`
          const raw = await new MailComposer({
            from: { name: item.senderName, address: from },
            to: item.to,
            cc: item.cc.length ? item.cc : undefined,
            subject: item.subject,
            text: item.body,
            messageId,
            inReplyTo: inReplyTo ? bracket(inReplyTo) : undefined,
            references: inReplyTo ? [...new Set([threadKey, inReplyTo].filter(Boolean).map(id => bracket(id!)))] : undefined,
          }).compile().build()
          await smtp.sendMail({ envelope: { from, to: [...item.to, ...item.cc] }, raw })
          await imap.append(sentFolder, raw, ['\\Seen']).catch(e => console.warn(`Sent, but not filed in ${sentFolder}: ${e}`))
          sent.push({ id: item.id, ok: true, gmailMessageId: messageId, gmailThreadId: threadKey ?? messageId })
          console.log(`Sent: ${item.subject} → ${item.to.join(', ')}`)
        } catch (e) {
          sent.push({ id: item.id, ok: false, error: e instanceof Error ? e.message : String(e) })
          console.error(`Failed: ${item.subject}: ${e}`)
        }
      }
      await recordSent(db, sent)
    }

    // 3. Replies to our emails, and bounces
    const state = readState()
    const startedAt = new Date()
    const since = state.lastInboundCheck ? new Date(new Date(state.lastInboundCheck).getTime() - OVERLAP_MS) : new Date(Date.now() - FIRST_RUN_LOOKBACK_MS)
    const candidates: { item: Omit<InboundItem, 'gmailThreadId'>; refs: string[] }[] = []
    const lock = await imap.getMailboxLock('INBOX')
    try {
      const uids = await imap.search({ since: new Date(since.getTime() - 86400_000) }, { uid: true })
      if (uids && uids.length) {
        for await (const msg of imap.fetch(uids, { source: true, internalDate: true }, { uid: true })) {
          const received = msg.internalDate ? new Date(msg.internalDate) : null
          if (!received || received < since || !msg.source) continue
          const mail = await simpleParser(msg.source)
          const sender = mail.from?.value?.[0]?.address?.toLowerCase() ?? ''
          if (sender === from.toLowerCase()) continue
          const refs = [mail.inReplyTo, ...(Array.isArray(mail.references) ? mail.references : mail.references ? [mail.references] : [])]
            .filter((r): r is string => Boolean(r)).map(bracket)
          const isBounce = /mailer-daemon|postmaster|microsoftexchange/i.test(sender) || /undeliverable|unzustellbar|delivery status notification/i.test(mail.subject ?? '')
          if (!refs.length && !isBounce) continue
          candidates.push({
            refs,
            item: {
              gmailMessageId: bracket(mail.messageId ?? `${randomUUID()}@unknown`),
              from: mail.from?.text ?? sender,
              to: mail.to ? (Array.isArray(mail.to) ? mail.to.map(t => t.text).join(', ') : mail.to.text) : undefined,
              cc: mail.cc ? (Array.isArray(mail.cc) ? mail.cc.map(t => t.text).join(', ') : mail.cc.text) : undefined,
              date: (mail.date ?? received).toISOString(),
              subject: mail.subject ?? '',
              body: (mail.text ?? '').slice(0, 20000),
              isBounce,
            },
          })
        }
      }
    } finally {
      lock.release()
    }

    // Keep only mail that answers one of our own messages (or bounces)
    const allRefs = [...new Set(candidates.flatMap(c => c.refs))]
    const known = new Map<string, string>()
    for (let i = 0; i < allRefs.length; i += 100) {
      const { data } = await db.from('email_messages').select('gmail_message_id, gmail_thread_id').in('gmail_message_id', allRefs.slice(i, i + 100))
      for (const r of data ?? []) known.set(r.gmail_message_id as string, r.gmail_thread_id as string)
    }
    const inbound: InboundItem[] = []
    for (const c of candidates) {
      const thread = c.refs.map(r => known.get(r)).find(Boolean)
      if (thread) inbound.push({ ...c.item, gmailThreadId: thread })
      else if (c.item.isBounce) inbound.push({ ...c.item, gmailThreadId: c.item.gmailMessageId })
    }
    console.log(`Inbox: ${candidates.length} candidate messages since ${since.toISOString()}, ${inbound.length} belong to outreach threads`)

    if (dryRun) {
      inbound.forEach(i => console.log(`  would store: ${i.from} | ${i.subject}`))
      return
    }

    // 4. Store and process, like the former push endpoint
    const stored = await storeInbound(db, inbound)
    const classified = await processInbound(db, settings, 35_000)
    const followups = settings.mode === 'off' ? 0 : await queueFollowups(db, settings)
    await db.from('mail_settings').update({ last_bridge_at: new Date().toISOString(), last_bridge_error: null }).eq('id', true)
    writeState({ lastInboundCheck: startedAt.toISOString() })
    console.log(`Stored ${stored} replies, classified ${classified}, queued ${followups} reminders.`)
  } finally {
    await imap.logout().catch(() => {})
  }
}

main().catch(async error => {
  console.error(error instanceof Error ? error.message : error)
  try {
    await createAdminClient().from('mail_settings')
      .update({ last_bridge_error: `Mail bridge: ${error instanceof Error ? error.message : String(error)}` }).eq('id', true)
  } catch { /* the error above is what matters */ }
  process.exit(1)
})
