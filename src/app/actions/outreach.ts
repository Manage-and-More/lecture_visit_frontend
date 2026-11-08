'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { findTargets, type TargetResult } from '@/lib/outreach/targets'
import { aiReadingEnabled, getSettings, renderTemplated } from '@/lib/outreach/engine'
import type {
  EmailMessage, MailSettings, OutreachThreadStatus, ProfessorOutreach,
} from '@/types/database'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) throw new Error('Only admins can manage outreach')
  return { supabase, userId: user.id }
}

async function activeSemester(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string> {
  const { data } = await supabase.from('parameters').select('value').eq('key', 'active_semester').single()
  return data?.value ?? 'WiSe 2026/27'
}

export type OutreachThread = ProfessorOutreach & {
  professor: { first_name: string | null; last_name: string | null; title: string | null } | null
  lectures: { response: string; position: number; lecture: { id: string; title: string } | null }[]
}

export type OutreachOverview = {
  isAdmin: boolean
  semester: string
  settings: MailSettings | null
  sentLastDay: number
  queuedCount: number
  /** The Gmail script checked in within the last 15 minutes */
  bridgeHealthy: boolean
  /** Replies nobody has read yet (in a Claude Code session or by hand) */
  unreadReplies: number
  aiReading: boolean
  threads: OutreachThread[]
}

export async function getOutreachOverview(): Promise<OutreachOverview> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = user
    ? await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
    : { data: null }
  const semester = await activeSemester(supabase)
  if (!profile?.is_admin) {
    return { isAdmin: false, semester, settings: null, sentLastDay: 0, queuedCount: 0, bridgeHealthy: false, unreadReplies: 0, aiReading: false, threads: [] }
  }

  const settings = await getSettings(supabase)
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString()
  const [{ count: sentLastDay }, { count: queuedCount }, { data: threads }, { count: unreadReplies }] = await Promise.all([
    supabase.from('email_messages').select('id', { count: 'exact', head: true })
      .eq('direction', 'outbound').in('status', ['sent', 'sending']).gte('lease_at', dayAgo),
    supabase.from('email_messages').select('id', { count: 'exact', head: true })
      .eq('direction', 'outbound').eq('status', 'queued'),
    supabase.from('professor_outreach')
      .select('*, professor:professors(first_name, last_name, title), lectures:outreach_lectures(response, position, lecture:lectures(id, title))')
      .eq('semester', semester)
      .order('updated_at', { ascending: false })
      .limit(1000),
    supabase.from('email_messages').select('id', { count: 'exact', head: true })
      .eq('direction', 'inbound').eq('kind', 'reply').is('classified_at', null),
  ])

  return {
    isAdmin: true,
    semester,
    settings,
    sentLastDay: sentLastDay ?? 0,
    queuedCount: queuedCount ?? 0,
    unreadReplies: unreadReplies ?? 0,
    aiReading: aiReadingEnabled(),
    bridgeHealthy: !!settings.last_bridge_at && Date.now() - new Date(settings.last_bridge_at).getTime() < 15 * 60_000,
    threads: (threads ?? []) as unknown as OutreachThread[],
  }
}

export async function getThreadMessages(outreachId: string): Promise<EmailMessage[]> {
  const { supabase } = await requireAdmin()
  const { data, error } = await supabase.from('email_messages')
    .select('*').eq('outreach_id', outreachId).order('created_at')
  if (error) throw error
  return (data ?? []) as EmailMessage[]
}

export async function previewTargets(): Promise<TargetResult> {
  const { supabase } = await requireAdmin()
  const settings = await getSettings(supabase)
  return findTargets(supabase, await activeSemester(supabase), settings)
}

/** Queues the first email for the chosen lecturers. Targets are recomputed on the server. */
export async function queueOutreach(professorIds: string[]): Promise<{ queued: number }> {
  const { supabase, userId } = await requireAdmin()
  const settings = await getSettings(supabase)
  const semester = await activeSemester(supabase)
  const { candidates } = await findTargets(supabase, semester, settings)
  const chosen = candidates.filter(c => professorIds.includes(c.professorId))

  let queued = 0
  for (const candidate of chosen) {
    const { data: outreach, error } = await supabase.from('professor_outreach').insert({
      professor_id: candidate.professorId,
      semester,
      status: 'queued',
      to_email: candidate.email,
      cc_emails: candidate.cc.map(c => c.email),
      created_by: userId,
    }).select('id').single()
    if (error || !outreach) continue

    await supabase.from('outreach_lectures').insert(
      candidate.lectures.map((l, position) => ({ outreach_id: outreach.id, lecture_id: l.id, position })),
    )
    await supabase.from('email_messages').insert({
      outreach_id: outreach.id,
      direction: 'outbound',
      kind: 'request',
      status: 'queued',
      to_emails: [candidate.email],
      cc_emails: candidate.cc.map(c => c.email),
      queued_at: new Date().toISOString(),
      created_by: userId,
    })
    queued++
  }
  revalidatePath('/outreach')
  return { queued }
}

/** The first email as the lecturer would receive it, using the current templates. */
export async function previewRequestEmail(outreachId: string): Promise<{ subject: string; body: string }> {
  const { supabase } = await requireAdmin()
  const settings = await getSettings(supabase)
  return renderTemplated(supabase, settings, outreachId, 'request')
}

const EDITABLE_SETTINGS = [
  'mode', 'daily_cap', 'per_run_cap', 'followup_after_days', 'max_followups', 'auto_ack_yes',
  'auto_ack_no', 'lecture_type_filter', 'sender_name', 'subject_request', 'template_request',
  'template_followup', 'template_ack_yes', 'template_ack_no', 'template_confirmation',
] as const
type EditableSettings = Partial<Pick<MailSettings, (typeof EDITABLE_SETTINGS)[number]>>

export async function updateMailSettings(changes: EditableSettings): Promise<void> {
  const { supabase, userId } = await requireAdmin()
  const update: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: userId }
  for (const key of EDITABLE_SETTINGS) {
    if (key in changes) update[key] = changes[key]
  }
  const { error } = await supabase.from('mail_settings').update(update).eq('id', true)
  if (error) throw error
  revalidatePath('/outreach')
}

export async function setThreadStatus(outreachId: string, status: OutreachThreadStatus): Promise<void> {
  const { supabase } = await requireAdmin()
  const { error } = await supabase.from('professor_outreach')
    .update({ status, attention_reason: null, updated_at: new Date().toISOString() })
    .eq('id', outreachId)
  if (error) throw error
  // A person decided: replies that were waiting to be read count as handled
  await supabase.from('email_messages')
    .update({ classified_at: new Date().toISOString(), processing_error: null })
    .eq('outreach_id', outreachId).eq('direction', 'inbound').is('classified_at', null)
  if (status === 'cancelled' || status === 'do_not_contact') {
    await supabase.from('email_messages').update({ status: 'cancelled' })
      .eq('outreach_id', outreachId).eq('status', 'queued')
  }
  if (status === 'do_not_contact') {
    const { data: outreach } = await supabase.from('professor_outreach')
      .select('to_email, professor_id').eq('id', outreachId).single()
    if (outreach) {
      await supabase.from('do_not_contact').upsert({
        email: outreach.to_email.toLowerCase(), professor_id: outreach.professor_id, reason: 'Marked by an admin',
      })
    }
  }
  revalidatePath('/outreach')
}

/** Queues a reply written by a person. It answers the lecturer's latest email in its thread. */
export async function queueManualReply(outreachId: string, body: string): Promise<void> {
  const { supabase, userId } = await requireAdmin()
  if (!body.trim()) throw new Error('The reply is empty')
  const { data: outreach } = await supabase.from('professor_outreach')
    .select('to_email, cc_emails').eq('id', outreachId).single()
  if (!outreach) throw new Error('Thread not found')
  const { data: lastInbound } = await supabase.from('email_messages')
    .select('gmail_message_id, subject, from_email')
    .eq('outreach_id', outreachId).eq('direction', 'inbound').eq('kind', 'reply')
    .order('received_at', { ascending: false }).limit(1).maybeSingle()
  const { data: request } = await supabase.from('email_messages')
    .select('subject').eq('outreach_id', outreachId).eq('kind', 'request').limit(1).maybeSingle()

  const subjectBase = lastInbound?.subject || request?.subject || ''
  const { error } = await supabase.from('email_messages').insert({
    outreach_id: outreachId,
    direction: 'outbound',
    kind: 'manual',
    status: 'queued',
    to_emails: [outreach.to_email],
    cc_emails: lastInbound ? [] : outreach.cc_emails,
    subject: subjectBase.toLowerCase().startsWith('re:') ? subjectBase : `Re: ${subjectBase}`,
    body: body.trim(),
    reply_to_gmail_message_id: lastInbound?.gmail_message_id ?? null,
    queued_at: new Date().toISOString(),
    created_by: userId,
  })
  if (error) throw error
  revalidatePath('/outreach')
}

export async function cancelQueuedMessage(messageId: string): Promise<void> {
  const { supabase } = await requireAdmin()
  const { data: message, error } = await supabase.from('email_messages')
    .update({ status: 'cancelled' }).eq('id', messageId).eq('status', 'queued')
    .select('kind, outreach_id').maybeSingle()
  if (error) throw error
  // Without its first email the thread never starts
  if (message?.kind === 'request') {
    await supabase.from('professor_outreach')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', message.outreach_id).eq('status', 'queued')
  }
  revalidatePath('/outreach')
}
