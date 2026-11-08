import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  EmailMessage, MailSettings, ProfessorOutreach, ReplyClassification,
} from '@/types/database'
import { classifyReply, ClassificationRefusedError } from './classify'
import { cleanLectureTitle, findUnfilled, lecturePhrase, render, salutationName, templateFor, type TemplateKind } from './templates'

type Db = SupabaseClient

/** Statuses whose Gmail threads the bridge keeps watching for replies. */
const WATCHED_STATUSES = ['awaiting_reply', 'interested', 'needs_attention', 'scheduled', 'declined']
const LEASE_TIMEOUT_MINUTES = 30
export const NEW_REPLY_REASON = 'New reply, not read yet'

/** Replies are read by the Claude API only when a key is configured; otherwise in a Claude Code session. */
export function aiReadingEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

export type OutboxItem = {
  id: string
  to: string[]
  cc: string[]
  subject: string
  body: string
  replyToGmailMessageId: string | null
  senderName: string
}

export type SentResult = {
  id: string
  ok: boolean
  gmailMessageId?: string
  gmailThreadId?: string
  error?: string
}

export type InboundItem = {
  gmailMessageId: string
  gmailThreadId: string
  from: string
  to?: string
  cc?: string
  date: string
  subject: string
  body: string
  isBounce?: boolean
}

export async function getSettings(db: Db): Promise<MailSettings> {
  const { data, error } = await db.from('mail_settings').select('*').eq('id', true).single()
  if (error || !data) throw new Error(`Mail settings missing: ${error?.message ?? 'no row'}`)
  return data as MailSettings
}

function addressOf(from: string): string {
  const match = from.match(/<([^>]+)>/)
  return (match ? match[1] : from).trim().toLowerCase()
}

type OutreachContext = {
  outreach: ProfessorOutreach
  professor: { title: string | null; first_name: string | null; last_name: string | null }
  lectureTitles: string[]
}

async function loadContext(db: Db, outreachId: string): Promise<OutreachContext> {
  const { data: outreach, error } = await db
    .from('professor_outreach')
    .select('*, professor:professors(title, first_name, last_name)')
    .eq('id', outreachId)
    .single()
  if (error || !outreach) throw new Error(`Outreach ${outreachId} not found`)
  const { data: lectures } = await db
    .from('outreach_lectures')
    .select('position, lecture:lectures(title)')
    .eq('outreach_id', outreachId)
    .order('position')
  const lectureTitles = (lectures ?? [])
    .map(l => (l as unknown as { lecture: { title: string } | null }).lecture?.title)
    .filter((t): t is string => Boolean(t))
  const { professor, ...rest } = outreach as ProfessorOutreach & { professor: OutreachContext['professor'] }
  return { outreach: rest as ProfessorOutreach, professor, lectureTitles }
}

/** Builds the text of a templated email (everything except manual replies). */
export async function renderTemplated(
  db: Db, settings: MailSettings, outreachId: string, kind: TemplateKind,
  extra: Record<string, string> = {},
): Promise<{ subject: string; body: string }> {
  const ctx = await loadContext(db, outreachId)
  let originalMessage = ''
  if (kind === 'followup') {
    const { data } = await db
      .from('email_messages')
      .select('body')
      .eq('outreach_id', outreachId)
      .eq('kind', 'request')
      .eq('status', 'sent')
      .limit(1)
      .maybeSingle()
    originalMessage = data?.body ?? ''
  }
  const values = {
    salutation_name: salutationName(ctx.professor),
    sender_name: settings.sender_name,
    lecture_phrase: lecturePhrase(ctx.lectureTitles),
    lecture_list: ctx.lectureTitles.map(t => `- ${cleanLectureTitle(t)}`).join('\n'),
    original_message: originalMessage,
    ...extra,
  }
  const body = render(templateFor(settings, kind), values)
  const subject = kind === 'followup'
    ? `Re: ${render(settings.subject_request, values)}`
    : render(settings.subject_request, values)
  return { subject, body }
}

/**
 * Picks the emails the bridge should send now, fills in templated text, and marks them as
 * sending. In test mode every email goes to the sender's own address instead.
 */
export async function leaseOutbox(db: Db, settings: MailSettings): Promise<{ outbox: OutboxItem[]; blocked: string[] }> {
  const now = new Date()

  // A message that was handed out but never confirmed may or may not have been sent.
  // It is failed instead of retried, so nobody gets the same email twice.
  const staleBefore = new Date(now.getTime() - LEASE_TIMEOUT_MINUTES * 60_000).toISOString()
  await db.from('email_messages')
    .update({ status: 'failed', error: 'No send confirmation from the mail bridge; not retried to avoid a duplicate email.' })
    .eq('status', 'sending')
    .lt('lease_at', staleBefore)

  if (settings.mode === 'off') return { outbox: [], blocked: [] }

  const dayAgo = new Date(now.getTime() - 24 * 3600_000).toISOString()
  const { count: sentLastDay } = await db.from('email_messages')
    .select('id', { count: 'exact', head: true })
    .eq('direction', 'outbound')
    .in('status', ['sent', 'sending'])
    .gte('lease_at', dayAgo)
  const remaining = Math.min(settings.per_run_cap, settings.daily_cap - (sentLastDay ?? 0))
  if (remaining <= 0) return { outbox: [], blocked: [] }

  const { data: queued } = await db.from('email_messages')
    .select('*')
    .eq('direction', 'outbound')
    .eq('status', 'queued')
    .order('queued_at')
    .limit(remaining)

  const outbox: OutboxItem[] = []
  const blocked: string[] = []
  for (const message of (queued ?? []) as EmailMessage[]) {
    const { data: optedOut } = await db.from('do_not_contact')
      .select('email').in('email', message.to_emails.map(e => e.toLowerCase()))
    if (optedOut?.length) {
      await db.from('email_messages')
        .update({ status: 'cancelled', error: 'The recipient asked not to be contacted.' })
        .eq('id', message.id)
      continue
    }
    let { subject, body } = message
    if (message.kind !== 'manual' && !body) {
      const rendered = await renderTemplated(db, settings, message.outreach_id, message.kind as TemplateKind)
      subject = message.subject || rendered.subject
      body = rendered.body
    }
    const unfilled = findUnfilled(`${subject}\n${body}`)
    if (unfilled) {
      blocked.push(`${message.kind} email not sent: the text still contains ${unfilled}`)
      continue
    }

    const isTest = settings.mode === 'test'
    const to = isTest ? [settings.sender_email] : message.to_emails
    const cc = isTest ? [] : message.cc_emails
    const sendSubject = isTest ? `[TEST an ${message.to_emails.join(', ')}] ${subject}` : subject

    const { error } = await db.from('email_messages')
      .update({ status: 'sending', lease_at: now.toISOString(), attempts: message.attempts + 1, subject, body })
      .eq('id', message.id)
      .eq('status', 'queued')
    if (error) continue

    outbox.push({
      id: message.id,
      to,
      cc,
      subject: sendSubject,
      body,
      replyToGmailMessageId: message.reply_to_gmail_message_id,
      senderName: settings.sender_name,
    })
  }
  return { outbox, blocked }
}

/** Gmail threads with replies the bridge should look for. */
export async function trackedThreadIds(db: Db): Promise<string[]> {
  const since = new Date(Date.now() - 120 * 86400_000).toISOString()
  const { data } = await db.from('email_messages')
    .select('gmail_thread_id, outreach:professor_outreach!inner(status)')
    .not('gmail_thread_id', 'is', null)
    .in('outreach.status', WATCHED_STATUSES)
    .gte('created_at', since)
    .limit(5000)
  return [...new Set((data ?? []).map(r => r.gmail_thread_id as string))]
}

export async function recordSent(db: Db, results: SentResult[]): Promise<void> {
  const now = new Date().toISOString()
  for (const result of results) {
    const { data: message } = await db.from('email_messages')
      .select('id, outreach_id, kind')
      .eq('id', result.id)
      .maybeSingle()
    if (!message) continue

    if (!result.ok) {
      await db.from('email_messages')
        .update({ status: 'failed', error: result.error ?? 'Sending failed' })
        .eq('id', result.id)
      if (message.kind === 'request') {
        await db.from('professor_outreach')
          .update({ status: 'failed', attention_reason: `Sending failed: ${result.error ?? 'unknown error'}`, updated_at: now })
          .eq('id', message.outreach_id)
      }
      continue
    }

    await db.from('email_messages')
      .update({ status: 'sent', sent_at: now, gmail_message_id: result.gmailMessageId, gmail_thread_id: result.gmailThreadId, error: null })
      .eq('id', result.id)
    if (message.kind === 'request') {
      await db.from('professor_outreach')
        .update({ status: 'awaiting_reply', first_sent_at: now, updated_at: now })
        .eq('id', message.outreach_id)
        .eq('status', 'queued')
    }
  }
}

export async function storeInbound(db: Db, items: InboundItem[]): Promise<number> {
  let stored = 0
  for (const item of items) {
    const { data: existing } = await db.from('email_messages')
      .select('id').eq('gmail_message_id', item.gmailMessageId).maybeSingle()
    if (existing) continue

    let outreachId: string | null = null
    if (item.isBounce) {
      // Match a bounce to the outreach whose recipient address appears in it
      const { data: candidates } = await db.from('professor_outreach')
        .select('id, to_email').in('status', ['awaiting_reply', 'queued'])
      const body = item.body.toLowerCase()
      outreachId = (candidates ?? []).find(c => body.includes(c.to_email.toLowerCase()))?.id ?? null
    } else {
      const { data: sibling } = await db.from('email_messages')
        .select('outreach_id').eq('gmail_thread_id', item.gmailThreadId).limit(1).maybeSingle()
      outreachId = sibling?.outreach_id ?? null
    }
    if (!outreachId) continue

    const receivedAt = new Date(item.date).toISOString()
    const { error } = await db.from('email_messages').insert({
      outreach_id: outreachId,
      direction: 'inbound',
      kind: item.isBounce ? 'bounce' : 'reply',
      status: 'received',
      from_email: item.from,
      to_emails: item.to ? [item.to] : [],
      cc_emails: item.cc ? [item.cc] : [],
      subject: item.subject,
      body: item.body,
      gmail_message_id: item.gmailMessageId,
      gmail_thread_id: item.gmailThreadId,
      received_at: receivedAt,
      // Bounces need no AI: the address doesn't work
      classified_at: item.isBounce ? new Date().toISOString() : null,
    })
    if (error) continue
    stored++

    if (item.isBounce) {
      await db.from('professor_outreach')
        .update({ status: 'failed', attention_reason: 'The email bounced: the address may be wrong or no longer in use.', updated_at: new Date().toISOString() })
        .eq('id', outreachId)
    } else {
      const update: Partial<ProfessorOutreach> = { last_inbound_at: receivedAt, updated_at: new Date().toISOString() }
      // Without an API key nothing reads replies automatically: show them to a person right away
      if (!aiReadingEnabled()) {
        update.status = 'needs_attention'
        update.attention_reason = NEW_REPLY_REASON
      }
      await db.from('professor_outreach').update(update).eq('id', outreachId)
    }
  }
  return stored
}

async function queueTemplatedReply(
  db: Db, settings: MailSettings, ctx: OutreachContext, kind: 'ack_yes' | 'ack_no', inbound: EmailMessage,
): Promise<void> {
  const { count } = await db.from('email_messages')
    .select('id', { count: 'exact', head: true })
    .eq('outreach_id', ctx.outreach.id)
    .eq('kind', kind)
    .neq('status', 'cancelled')
  if (count) return
  const { subject, body } = await renderTemplated(db, settings, ctx.outreach.id, kind)
  await db.from('email_messages').insert({
    outreach_id: ctx.outreach.id,
    direction: 'outbound',
    kind,
    status: 'queued',
    to_emails: [addressOf(inbound.from_email ?? ctx.outreach.to_email)],
    subject: `Re: ${inbound.subject || subject}`,
    body,
    reply_to_gmail_message_id: inbound.gmail_message_id,
    queued_at: new Date().toISOString(),
  })
}

export async function applyClassification(
  db: Db, settings: MailSettings, inbound: EmailMessage, c: ReplyClassification,
  options: { skipAutoReply?: boolean } = {},
): Promise<void> {
  const ctx = await loadContext(db, inbound.outreach_id)
  const now = new Date().toISOString()
  const { data: lectureRows } = await db.from('outreach_lectures')
    .select('lecture_id, position').eq('outreach_id', ctx.outreach.id).order('position')
  const lectures = lectureRows ?? []

  const setResponses = async (fallback: 'yes' | 'no') => {
    for (const [index, row] of lectures.entries()) {
      const decision = c.lecture_decisions.find(d => d.lecture_number === index + 1)?.decision
      const response = c.lecture_decisions.length === 0 ? fallback : decision === 'yes' || decision === 'no' ? decision : 'pending'
      await db.from('outreach_lectures').update({ response })
        .eq('outreach_id', ctx.outreach.id).eq('lecture_id', row.lecture_id)
    }
  }

  const update: Partial<ProfessorOutreach> = { ai_summary: c.summary, updated_at: now }
  const reviewFirst = c.needs_human || c.confidence === 'low'

  if (c.category === 'do_not_contact') {
    await db.from('do_not_contact').upsert({
      email: addressOf(inbound.from_email ?? ctx.outreach.to_email),
      professor_id: ctx.outreach.professor_id,
      reason: c.summary,
    })
    await db.from('email_messages').update({ status: 'cancelled' })
      .eq('outreach_id', ctx.outreach.id).eq('status', 'queued')
    update.status = 'do_not_contact'
    update.attention_reason = null
  } else if (c.category === 'out_of_office') {
    // Not a decision: keep waiting, the follow-up timer still applies
    if (ctx.outreach.status === 'needs_attention' && ctx.outreach.attention_reason === NEW_REPLY_REASON) {
      update.status = 'awaiting_reply'
      update.attention_reason = null
    }
  } else if ((c.category === 'yes' || c.category === 'no') && !reviewFirst) {
    const anyYes = c.category === 'yes' || c.lecture_decisions.some(d => d.decision === 'yes')
    await setResponses(c.category)
    if (ctx.outreach.status !== 'scheduled') update.status = anyYes ? 'interested' : 'declined'
    update.attention_reason = null
    // A reply written for this email replaces the automatic thank-you
    if (!options.skipAutoReply) {
      if (anyYes && settings.auto_ack_yes) await queueTemplatedReply(db, settings, ctx, 'ack_yes', inbound)
      if (!anyYes && settings.auto_ack_no) await queueTemplatedReply(db, settings, ctx, 'ack_no', inbound)
    }
  } else {
    update.status = 'needs_attention'
    update.attention_reason = c.reason_for_human ?? `Reply classified as "${c.category}" (${c.confidence} confidence)`
  }

  await db.from('professor_outreach').update(update).eq('id', ctx.outreach.id)
}

/** Classifies new replies until the time budget runs out; the rest wait for the next run. */
export async function processInbound(db: Db, settings: MailSettings, budgetMs: number): Promise<number> {
  if (!aiReadingEnabled()) return 0
  const started = Date.now()
  const { data: pending } = await db.from('email_messages')
    .select('*')
    .eq('direction', 'inbound')
    .eq('kind', 'reply')
    .is('classified_at', null)
    .order('received_at')
    .limit(10)

  let processed = 0
  for (const inbound of (pending ?? []) as EmailMessage[]) {
    if (Date.now() - started > budgetMs) break
    const ctx = await loadContext(db, inbound.outreach_id)
    const { data: lastOutbound } = await db.from('email_messages')
      .select('body').eq('outreach_id', inbound.outreach_id).eq('direction', 'outbound').eq('status', 'sent')
      .order('sent_at', { ascending: false }).limit(1).maybeSingle()
    try {
      const classification = await classifyReply({
        lectureTitles: ctx.lectureTitles,
        lastOutboundBody: lastOutbound?.body ?? null,
        from: inbound.from_email ?? '',
        subject: inbound.subject,
        body: inbound.body,
      })
      await db.from('email_messages')
        .update({ classification, classified_at: new Date().toISOString(), processing_error: null })
        .eq('id', inbound.id)
      await applyClassification(db, settings, inbound, classification)
      processed++
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      // A refusal won't change on retry; other errors (rate limits, outages) are retried next run
      const final = error instanceof ClassificationRefusedError
      await db.from('email_messages')
        .update({ processing_error: message, classified_at: final ? new Date().toISOString() : null })
        .eq('id', inbound.id)
      if (final) {
        await db.from('professor_outreach')
          .update({ status: 'needs_attention', attention_reason: message, updated_at: new Date().toISOString() })
          .eq('id', inbound.outreach_id)
      }
    }
  }
  return processed
}

/** Queues one reminder for lecturers who haven't answered within the configured days. */
export async function queueFollowups(db: Db, settings: MailSettings): Promise<number> {
  if (settings.max_followups === 0) return 0
  const before = new Date(Date.now() - settings.followup_after_days * 86400_000).toISOString()
  const { data: due } = await db.from('professor_outreach')
    .select('id, to_email, cc_emails, followups_sent')
    .eq('status', 'awaiting_reply')
    .lt('first_sent_at', before)
    .lt('followups_sent', settings.max_followups)
    .limit(50)

  let queued = 0
  for (const outreach of due ?? []) {
    const { count: pendingOut } = await db.from('email_messages')
      .select('id', { count: 'exact', head: true })
      .eq('outreach_id', outreach.id).in('status', ['queued', 'sending'])
    if (pendingOut) continue
    // Only automatic out-of-office replies leave the lecturer "unanswered"
    const { data: replies } = await db.from('email_messages')
      .select('classification').eq('outreach_id', outreach.id).eq('direction', 'inbound').eq('kind', 'reply')
    const answered = (replies ?? []).some(r =>
      (r.classification as ReplyClassification | null)?.category !== 'out_of_office')
    if (answered) continue
    const { error } = await db.from('email_messages').insert({
      outreach_id: outreach.id,
      direction: 'outbound',
      kind: 'followup',
      status: 'queued',
      to_emails: [outreach.to_email],
      cc_emails: outreach.cc_emails,
      queued_at: new Date().toISOString(),
    })
    if (error) continue
    await db.from('professor_outreach')
      .update({ followups_sent: outreach.followups_sent + 1, updated_at: new Date().toISOString() })
      .eq('id', outreach.id)
    queued++
  }
  return queued
}

/** Queues an answer to an inbound email, sent inside the lecturer's Gmail thread. */
export async function queueReplyTo(
  db: Db, inbound: EmailMessage, body: string, createdBy: string | null = null,
): Promise<void> {
  const { data: outreach } = await db.from('professor_outreach')
    .select('to_email').eq('id', inbound.outreach_id).single()
  const subject = inbound.subject.toLowerCase().startsWith('re:') ? inbound.subject : `Re: ${inbound.subject}`
  const { error } = await db.from('email_messages').insert({
    outreach_id: inbound.outreach_id,
    direction: 'outbound',
    kind: 'manual',
    status: 'queued',
    to_emails: [addressOf(inbound.from_email ?? outreach?.to_email ?? '')],
    subject,
    body: body.trim(),
    reply_to_gmail_message_id: inbound.gmail_message_id,
    queued_at: new Date().toISOString(),
    created_by: createdBy,
  })
  if (error) throw error
}
