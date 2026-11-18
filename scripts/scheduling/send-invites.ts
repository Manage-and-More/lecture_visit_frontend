/**
 * Emails each assigned member a calendar invite for their upcoming visits (one email per visit),
 * from the outreach sender address through the TUM mailbox (login from the macOS Keychain, as
 * for the mail bridge). A visit whose invite went out is marked in its notes and skipped later.
 *
 *   npm run -s visits:invite -- --dry-run            # prints the emails, sends nothing
 *   npm run -s visits:invite -- --test-to=addr       # sends all of them to addr only, marks nothing
 *   npm run -s visits:invite                         # sends to the members
 *       [--resend]                                   # also visits whose invite went out already
 *       [--limit=n]                                  # only the first n visits
 */
import '../mail-bridge/load-env'
import '../outreach/env'
import { execFileSync } from 'node:child_process'
import nodemailer from 'nodemailer'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSettings } from '@/lib/outreach/engine'

const KEYCHAIN_SERVICE = 'lecture-visit-tum-mail'
const SMTP_HOST = 'postout.lrz.de'
const APP_URL = 'https://mm-lecture-visit.fly.dev'
const SENT_MARK = 'Invite sent'
/** The calendar block: from a bit before the lecture starts until the visit is surely over */
const BLOCK_BEFORE_MIN = 15
const BLOCK_AFTER_MIN = 30

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const resend = args.includes('--resend')
const limit = Number(args.find(a => a.startsWith('--limit='))?.slice('--limit='.length) ?? Infinity)
const testTo = args.find(a => a.startsWith('--test-to='))?.slice('--test-to='.length).trim() || null

const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' })
const SHORT_DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Berlin' })
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Berlin' })

function keychainCredentials(): { user: string; pass: string } {
  const quiet = { encoding: 'utf8' as const, stdio: ['ignore', 'pipe', 'ignore'] as ('ignore' | 'pipe')[] }
  const attrs = execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE], quiet)
  const user = attrs.match(/"acct"<blob>="([^"]+)"/)?.[1]
  const pass = execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], quiet).trim()
  if (!user || !pass) throw new Error(`No TUM login in the Keychain (service ${KEYCHAIN_SERVICE})`)
  return { user, pass }
}

const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
/** Lines longer than 75 octets are folded (RFC 5545 3.1). */
function fold(line: string): string {
  const out: string[] = []
  let current = ''
  for (const ch of line) {
    if (Buffer.byteLength(current + ch) > (out.length ? 74 : 75)) { out.push(current); current = '' }
    current += ch
  }
  out.push(current)
  return out.join('\r\n ')
}

function invite(o: { uid: string; start: Date; end: Date; summary: string; location: string; description: string; organizer: { name: string; email: string }; attendee: { name: string; email: string } }) {
  return [
    'BEGIN:VCALENDAR', 'PRODID:-//Manage and More//Lecture visits//EN', 'VERSION:2.0', 'CALSCALE:GREGORIAN', 'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${o.uid}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(o.start)}`,
    `DTEND:${icsDate(o.end)}`,
    `SUMMARY:${icsText(o.summary)}`,
    `LOCATION:${icsText(o.location)}`,
    `DESCRIPTION:${icsText(o.description)}`,
    `ORGANIZER;CN=${icsText(o.organizer.name)}:mailto:${o.organizer.email}`,
    `ATTENDEE;CN=${icsText(o.attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${o.attendee.email}`,
    'SEQUENCE:0', 'STATUS:CONFIRMED', 'TRANSP:OPAQUE',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Lecture visit', 'TRIGGER:-PT1H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].map(fold).join('\r\n') + '\r\n'
}

type VisitRow = {
  id: string; scheduled_for: string; location: string | null; notes: string | null; assignee_ids: string[]
  lecture: { title: string; university: { name: string } | null } | null
}

async function main() {
  const db = createAdminClient()
  const settings = await getSettings(db)
  const organizer = { name: settings.sender_name, email: settings.sender_email }
  const signature = settings.sender_name.split(' ')[0]

  const { data, error } = await db.from('visits')
    .select('id, scheduled_for, location, notes, assignee_ids, lecture:lectures(title, university:universities(name))')
    .in('status', ['planned', 'confirmed'])
    .gte('scheduled_for', new Date().toISOString())
    .order('scheduled_for')
  if (error) throw error
  const visits = ((data ?? []) as unknown as VisitRow[]).filter(v => resend || testTo || !(v.notes ?? '').includes(SENT_MARK)).slice(0, limit)
  const memberIds = [...new Set(visits.flatMap(v => v.assignee_ids))]
  const { data: profiles } = await db.from('profiles').select('id, email, display_name').in('id', memberIds.length ? memberIds : ['00000000-0000-0000-0000-000000000000'])
  const people = new Map((profiles ?? []).map(p => [p.id as string, { email: (p.email as string | null) ?? '', name: ((p.display_name as string | null)?.trim() || (p.email as string | null)) ?? '' }]))

  const smtp = dryRun ? null : (() => {
    const { user, pass } = keychainCredentials()
    return nodemailer.createTransport({ host: SMTP_HOST, port: 587, secure: false, requireTLS: true, auth: { user, pass } })
  })()
  if (smtp) await smtp.verify()

  let sent = 0
  for (const v of visits) {
    const start = new Date(v.scheduled_for)
    const title = v.lecture?.title ?? 'Lecture'
    const uni = v.lecture?.university?.name
    const location = v.location ?? 'Room to be announced'
    for (const memberId of v.assignee_ids) {
      const person = people.get(memberId)
      if (!person?.email) { console.warn(`No email for member ${memberId}; skipped`); continue }
      const firstName = person.name.split(' ')[0]
      const others = v.assignee_ids.filter(id => id !== memberId).map(id => people.get(id)?.name).filter(Boolean)
      const subject = `Lecture visit on ${SHORT_DAY.format(start)}: ${title}`
      const text = [
        `Hi ${firstName},`,
        '',
        `thanks for entering your availability! You are assigned to visit this lecture for Manage and More${others.length ? ` together with ${others.join(', ')}` : ''}:`,
        '',
        `  Lecture: ${title}${uni ? ` (${uni})` : ''}`,
        `  When:    ${DAY.format(start)}, the lecture starts at ${TIME.format(start)}`,
        `  Where:   ${location}`,
        '',
        `Please accept the attached calendar invite and keep this time free. It starts ${BLOCK_BEFORE_MIN} minutes before the lecture so that you are there on time.`,
        '',
        `Next, I'll ask the lecturer for permission. If they say no or suggest another time, I'll let you know and update the invite. You can also see your visits on the home page of the Lecture Visit Tool: ${APP_URL}`,
        '',
        'Best,',
        signature,
      ].join('\n')
      const ics = invite({
        uid: `${v.id}@lecture-visits.manageandmore`,
        start: new Date(start.getTime() - BLOCK_BEFORE_MIN * 60_000),
        end: new Date(start.getTime() + BLOCK_AFTER_MIN * 60_000),
        summary: `Lecture visit: ${title}`,
        location,
        description: `Manage and More lecture visit. The lecture starts at ${TIME.format(start)}. To be confirmed with the lecturer; you'll hear from ${signature} if anything changes. ${APP_URL}`,
        organizer,
        attendee: { name: person.name, email: person.email },
      })
      const to = testTo ?? person.email
      if (dryRun) {
        console.log(`--- To: ${person.name} <${person.email}>\nSubject: ${subject}\n\n${text}\n`)
        continue
      }
      await smtp!.sendMail({
        from: { name: organizer.name, address: organizer.email },
        to,
        subject: testTo ? `[TEST for ${person.name}] ${subject}` : subject,
        text,
        icalEvent: { method: 'REQUEST', filename: 'invite.ics', content: ics },
      })
      sent++
      console.log(`Sent: ${subject} → ${to}`)
    }
    if (!dryRun && !testTo) {
      const note = `${v.notes ? `${v.notes}; ` : ''}${SENT_MARK} ${new Date().toISOString().slice(0, 10)}`
      await db.from('visits').update({ notes: note, updated_at: new Date().toISOString() }).eq('id', v.id)
    }
  }
  console.log(dryRun ? `Dry run: ${visits.length} visits, nothing sent.` : `${sent} emails sent.`)
}

main().catch(e => { console.error(e); process.exit(1) })
