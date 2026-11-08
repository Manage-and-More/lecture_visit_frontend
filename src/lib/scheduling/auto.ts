import type { SupabaseClient } from '@supabase/supabase-js'
import { sessionsInRange } from '@/lib/date-utils'
import { renderTemplated } from '@/lib/outreach/engine'
import { cleanLectureTitle } from '@/lib/outreach/templates'
import type { EmailMessage, LectureSchedule, MailSettings, ReplyClassification, Visit } from '@/types/database'
import { loadMembers, type CalendarMember } from './calendar'
import { covers, toDateKey, toMinutes } from './time'

type Db = SupabaseClient

/** Minutes a member must be free from the start of the session. */
const VISIT_WINDOW_MINUTES = 30
/** Visits of the same member must be at least this far apart (travel between campuses). */
const MIN_GAP_MINUTES = 90
const DEFAULT_DURATION = 10

export type ProposalResult = {
  proposed: number
  unscheduled: { title: string; reason: string }[]
}

type Busy = Map<string, number[]> // member id -> visit start times (ms)

function isBusy(busy: Busy, memberId: string, start: Date): boolean {
  return (busy.get(memberId) ?? []).some(t => Math.abs(t - start.getTime()) < MIN_GAP_MINUTES * 60_000)
}

/**
 * Proposes a visit for every lecture whose lecturer said yes and that has no visit yet: a session
 * on a date the lecturer suggested if possible, otherwise the earliest session in the coming weeks,
 * where two members (or at least one) are free, preferring members with fewer visits. Proposals are saved as "planned" visits for a person to accept.
 */
export async function proposeVisits(
  db: Db, semester: string, options: { weeksAhead: number },
): Promise<ProposalResult> {
  const { data: yesRows } = await db.from('outreach_lectures')
    .select('lecture_id, outreach_id, outreach:professor_outreach!inner(semester, status)')
    .eq('response', 'yes')
    .eq('outreach.semester', semester)
    .in('outreach.status', ['interested', 'scheduled'])
  const wanted = (yesRows ?? []) as unknown as { lecture_id: string; outreach_id: string }[]
  if (wanted.length === 0) return { proposed: 0, unscheduled: [] }

  const { data: existing } = await db.from('visits')
    .select('lecture_id, scheduled_for, assignee_ids, status')
    .in('status', ['planned', 'confirmed', 'done'])
  const visited = new Set((existing ?? []).map(v => v.lecture_id as string))
  const busy: Busy = new Map()
  const load = new Map<string, number>()
  for (const v of existing ?? []) {
    for (const id of (v.assignee_ids as string[]) ?? []) {
      load.set(id, (load.get(id) ?? 0) + 1)
      if (v.scheduled_for) busy.set(id, [...(busy.get(id) ?? []), new Date(v.scheduled_for as string).getTime()])
    }
  }

  // Only committed availability counts
  const members: CalendarMember[] = (await loadMembers(db)).filter(m => m.confirmed && m.slots.length > 0)
  const from = new Date()
  from.setDate(from.getDate() + 2) // give the lecturer notice
  const to = new Date(from)
  to.setDate(to.getDate() + options.weeksAhead * 7)

  const result: ProposalResult = { proposed: 0, unscheduled: [] }
  for (const { lecture_id: lectureId, outreach_id: outreachId } of wanted) {
    if (visited.has(lectureId)) continue
    const { data: lecture } = await db.from('lectures')
      .select('title, schedules:lecture_schedules(*)').eq('id', lectureId).single()
    if (!lecture) continue
    const title = lecture.title as string
    const { data: replies } = await db.from('email_messages')
      .select('classification').eq('outreach_id', outreachId).eq('direction', 'inbound')
      .not('classification', 'is', null).order('received_at', { ascending: false }).limit(1)
    const classification = replies?.[0]?.classification as ReplyClassification | null
    const conditions = classification?.conditions
    // Dates the lecturer suggested come first; otherwise the earliest session wins
    const suggested = new Set(classification?.mentioned_dates ?? [])
    const sessions = sessionsInRange(lecture.schedules as LectureSchedule[], from, to)
      .filter(s => s.date > new Date())
      .sort((a, b) => Number(suggested.has(toDateKey(b.date))) - Number(suggested.has(toDateKey(a.date))))
    if (sessions.length === 0) {
      result.unscheduled.push({ title, reason: `No session in the next ${options.weeksAhead} weeks` })
      continue
    }
    if (members.length === 0) {
      result.unscheduled.push({ title, reason: 'Nobody has confirmed their availability yet' })
      continue
    }

    let choice: { session: (typeof sessions)[number]; team: CalendarMember[] } | null = null
    for (const session of sessions) {
      const start = toMinutes(session.startTime)
      const free = members
        .filter(m => covers(m.slots, session.date, start, start + VISIT_WINDOW_MINUTES))
        .filter(m => !isBusy(busy, m.id, session.date))
        .sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0))
      if (free.length >= 2) { choice = { session, team: free.slice(0, 2) }; break }
      if (free.length === 1 && !choice) choice = { session, team: free }
    }
    if (!choice) {
      result.unscheduled.push({ title, reason: 'No member is free at any session' })
      continue
    }

    const { error } = await db.from('visits').insert({
      lecture_id: lectureId,
      outreach_id: outreachId,
      semester,
      scheduled_for: choice.session.date.toISOString(),
      duration_minutes: DEFAULT_DURATION,
      location: choice.session.location ?? null,
      status: 'planned',
      assignee_ids: choice.team.map(m => m.id),
      notes: conditions ? `Proposed automatically. Lecturer's conditions: ${conditions}` : 'Proposed automatically',
    })
    if (error) {
      result.unscheduled.push({ title, reason: error.message })
      continue
    }
    visited.add(lectureId)
    for (const m of choice.team) {
      load.set(m.id, (load.get(m.id) ?? 0) + 1)
      busy.set(m.id, [...(busy.get(m.id) ?? []), choice.session.date.getTime()])
    }
    result.proposed++
  }
  return result
}

// The email texts are English: "Tuesday, 17 November 2026", "10:15"
const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin',
})
const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Berlin' })

/**
 * Queues the date confirmation to the lecturer, as an answer to their latest reply (or as a
 * new email if they never replied by email), and marks the thread as scheduled.
 */
export async function queueVisitConfirmation(db: Db, settings: MailSettings, visit: Visit): Promise<boolean> {
  if (!visit.outreach_id || !visit.scheduled_for) return false
  const { data: outreach } = await db.from('professor_outreach')
    .select('id, to_email').eq('id', visit.outreach_id).single()
  if (!outreach) return false
  const { data: lecture } = await db.from('lectures').select('title').eq('id', visit.lecture_id).single()
  const start = new Date(visit.scheduled_for)
  const { body, subject } = await renderTemplated(db, settings, outreach.id, 'confirmation', {
    visit_date: DATE_FORMAT.format(start),
    visit_time: TIME_FORMAT.format(start),
    lecture_title: cleanLectureTitle((lecture?.title as string | undefined) ?? ''),
  })

  const { data: lastInbound } = await db.from('email_messages')
    .select('*').eq('outreach_id', outreach.id).eq('direction', 'inbound').eq('kind', 'reply')
    .order('received_at', { ascending: false }).limit(1).maybeSingle()
  const inbound = lastInbound as EmailMessage | null
  const replySubject = inbound?.subject || subject
  const { error } = await db.from('email_messages').insert({
    outreach_id: outreach.id,
    direction: 'outbound',
    kind: 'confirmation',
    status: 'queued',
    to_emails: [outreach.to_email],
    subject: replySubject.toLowerCase().startsWith('re:') ? replySubject : `Re: ${replySubject}`,
    body,
    reply_to_gmail_message_id: inbound?.gmail_message_id ?? null,
    queued_at: new Date().toISOString(),
  })
  if (error) throw error
  await db.from('professor_outreach')
    .update({ status: 'scheduled', attention_reason: null, updated_at: new Date().toISOString() })
    .eq('id', outreach.id)
  return true
}
