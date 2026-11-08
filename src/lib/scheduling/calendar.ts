import type { SupabaseClient } from '@supabase/supabase-js'
import { sessionsInRange } from '@/lib/date-utils'
import type {
  LectureSchedule, MailSettings, OutreachThreadStatus, ReplyClassification, Visit, VisitStatus,
} from '@/types/database'
import { isoWeekday, toMinutes, type Slot } from './time'

type Db = SupabaseClient

export type CalendarScope = 'outreach' | 'targets' | 'search'

export type CalendarSession = {
  key: string
  lectureId: string
  title: string
  university: string
  lectureType: string | null
  start: string // ISO
  weekday: number // 1 = Monday
  startMinutes: number
  endMinutes: number
  dateLabel: string // "Di. 17.11.2026"
  location: string | null
  lecturers: string
  outreachId: string | null
  outreachStatus: OutreachThreadStatus | null
  response: 'pending' | 'yes' | 'no' | null
  conditions: string | null
}

export type CalendarVisit = {
  id: string
  lectureId: string
  outreachId: string | null
  title: string
  start: string
  weekday: number
  startMinutes: number
  durationMinutes: number
  status: VisitStatus
  assigneeIds: string[]
  location: string | null
  notes: string | null
}

export type CalendarMember = { id: string; name: string; slots: Slot[] }

export type CalendarWeek = {
  semester: string
  weekStart: string
  sessions: CalendarSession[]
  visits: CalendarVisit[]
  members: CalendarMember[]
  truncated: boolean
}

const MAX_LECTURES = 600
const CHUNK = 150

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await build(from, from + 999)
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) return rows
  }
}

async function universityIds(db: Db, university: string): Promise<string[] | null> {
  if (university === 'all') return null
  const { data } = await db.from('universities').select('id').eq('name', university)
  return (data ?? []).map(u => u.id as string)
}

/** Lecture ids for the chosen scope, before the university filter. */
async function scopeLectureIds(
  db: Db, scope: CalendarScope, semester: string, search: string,
): Promise<string[]> {
  if (scope === 'outreach') {
    const rows = await fetchAll<{ lecture_id: string }>((from, to) =>
      db.from('outreach_lectures')
        .select('lecture_id, outreach:professor_outreach!inner(semester, status)')
        .eq('outreach.semester', semester)
        .neq('outreach.status', 'cancelled')
        .range(from, to))
    return [...new Set(rows.map(r => r.lecture_id))]
  }
  if (scope === 'targets') {
    const { data: programs } = await db.from('study_programs').select('id').eq('is_starred', true)
    const ids = new Set<string>()
    for (const programIds of chunks((programs ?? []).map(p => p.id as string))) {
      const links = await fetchAll<{ lecture_id: string }>((from, to) =>
        db.from('lecture_study_programs').select('lecture_id')
          .in('study_program_id', programIds).eq('lecture_obligation', 'mandatory').range(from, to))
      links.forEach(l => ids.add(l.lecture_id))
    }
    const starred = await fetchAll<{ id: string }>((from, to) =>
      db.from('lectures').select('id').eq('semester', semester).eq('is_starred', true).range(from, to))
    starred.forEach(l => ids.add(l.id))
    return [...ids]
  }
  const q = search.trim()
  if (q.length < 2) return []
  const { data } = await db.from('lectures').select('id')
    .eq('semester', semester).ilike('title', `%${q}%`).limit(MAX_LECTURES)
  return (data ?? []).map(l => l.id as string)
}

export async function loadCalendarWeek(
  db: Db,
  options: { semester: string; weekStart: Date; scope: CalendarScope; university: string; search: string; settings: MailSettings },
): Promise<CalendarWeek> {
  const { semester, weekStart, scope, university, search, settings } = options
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)

  const allowedUniversities = await universityIds(db, university)
  const lectureIds = await scopeLectureIds(db, scope, semester, search)

  type LectureRow = {
    id: string
    title: string
    lecture_type: string | null
    university_id: string
    university: { name: string } | null
    schedules: LectureSchedule[]
    lecture_professors: { professor: { title: string | null; first_name: string | null; last_name: string | null; email: string | null } | null }[]
  }
  const lectures: LectureRow[] = []
  for (const ids of chunks(lectureIds)) {
    let query = db.from('lectures')
      .select('id, title, lecture_type, university_id, university:universities(name), schedules:lecture_schedules(*), lecture_professors(professor:professors(title, first_name, last_name, email))')
      .in('id', ids)
      .eq('semester', semester)
    if (allowedUniversities) query = query.in('university_id', allowedUniversities)
    const { data } = await query
    // Only lectures we can actually ask: at least one lecturer with a known email address
    lectures.push(...((data ?? []) as unknown as LectureRow[])
      .filter(l => l.lecture_professors.some(lp => lp.professor?.email?.trim())))
  }
  // The cap applies after the semester and university filters, so no current lecture is dropped for an old one
  const truncated = lectures.length > MAX_LECTURES
  lectures.splice(MAX_LECTURES)

  // Outreach state per lecture (admins only; empty for others because of RLS)
  type OutreachRow = {
    lecture_id: string
    response: 'pending' | 'yes' | 'no'
    outreach: { id: string; status: OutreachThreadStatus } | null
  }
  const outreachByLecture = new Map<string, OutreachRow>()
  for (const ids of chunks(lectures.map(l => l.id))) {
    const { data } = await db.from('outreach_lectures')
      .select('lecture_id, response, outreach:professor_outreach!inner(id, status, semester)')
      .in('lecture_id', ids)
      .eq('outreach.semester', semester)
    for (const row of (data ?? []) as unknown as OutreachRow[]) outreachByLecture.set(row.lecture_id, row)
  }
  const conditionsByOutreach = new Map<string, string>()
  const outreachIds = [...new Set([...outreachByLecture.values()].map(r => r.outreach?.id).filter((id): id is string => !!id))]
  for (const ids of chunks(outreachIds)) {
    const { data } = await db.from('email_messages')
      .select('outreach_id, classification, received_at')
      .in('outreach_id', ids).eq('direction', 'inbound').not('classification', 'is', null)
      .order('received_at')
    for (const m of data ?? []) {
      const c = m.classification as ReplyClassification | null
      if (c?.conditions) conditionsByOutreach.set(m.outreach_id as string, c.conditions)
    }
  }

  // Scope "targets" follows the outreach lecture-type setting; the other scopes show everything
  const typeFilter = scope === 'targets' ? settings.lecture_type_filter.trim().toLowerCase() : ''

  const sessions: CalendarSession[] = []
  for (const lecture of lectures) {
    if (typeFilter && !(lecture.lecture_type ?? '').toLowerCase().includes(typeFilter)) continue
    const outreach = outreachByLecture.get(lecture.id)
    const lecturers = lecture.lecture_professors
      .map(lp => lp.professor).filter(Boolean)
      .map(p => [p!.title, p!.first_name, p!.last_name].filter(Boolean).join(' '))
      .join(', ')
    for (const s of sessionsInRange(lecture.schedules, weekStart, weekEnd)) {
      sessions.push({
        key: `${lecture.id}|${s.date.toISOString()}`,
        lectureId: lecture.id,
        title: lecture.title,
        university: lecture.university?.name ?? '',
        lectureType: lecture.lecture_type,
        start: s.date.toISOString(),
        weekday: isoWeekday(s.date),
        startMinutes: toMinutes(s.startTime),
        endMinutes: toMinutes(s.endTime),
        dateLabel: s.label.split(',')[0],
        location: s.location ?? null,
        lecturers,
        outreachId: outreach?.outreach?.id ?? null,
        outreachStatus: outreach?.outreach?.status ?? null,
        response: outreach?.response ?? null,
        conditions: outreach?.outreach ? conditionsByOutreach.get(outreach.outreach.id) ?? null : null,
      })
    }
  }

  const afterWeek = new Date(weekEnd)
  afterWeek.setDate(afterWeek.getDate() + 1)
  const { data: visitRows } = await db.from('visits')
    .select('*, lecture:lectures(title)')
    .neq('status', 'cancelled')
    .gte('scheduled_for', weekStart.toISOString())
    .lt('scheduled_for', afterWeek.toISOString())
  const visits: CalendarVisit[] = ((visitRows ?? []) as unknown as (Visit & { lecture: { title: string } | null })[])
    .filter(v => v.scheduled_for)
    .map(v => {
      const start = new Date(v.scheduled_for!)
      return {
        id: v.id,
        lectureId: v.lecture_id,
        outreachId: v.outreach_id,
        title: v.lecture?.title ?? 'Lecture',
        start: v.scheduled_for!,
        weekday: isoWeekday(start),
        startMinutes: start.getHours() * 60 + start.getMinutes(),
        durationMinutes: v.duration_minutes,
        status: v.status,
        assigneeIds: v.assignee_ids,
        location: v.location,
        notes: v.notes,
      }
    })

  const members = await loadMembers(db)
  return { semester, weekStart: weekStart.toISOString(), sessions, visits, members, truncated }
}

/** The current team (public.team_members) who have an account, with their weekly availability. */
export async function loadMembers(db: Db): Promise<CalendarMember[]> {
  const { data: team } = await db.from('team_members').select('email, name')
  const teamNames = new Map((team ?? []).map(t => [(t.email as string).toLowerCase(), t.name as string]))
  if (teamNames.size === 0) return []

  const { data: profiles } = await db.from('profiles').select('id, email').in('email', [...teamNames.keys()])
  const profileIds = (profiles ?? []).map(p => p.id as string)
  const { data: slots } = profileIds.length
    ? await db.from('member_availability').select('profile_id, date, start_time, end_time, repeats_weekly, repeat_until').in('profile_id', profileIds)
    : { data: [] }
  const byProfile = new Map<string, Slot[]>()
  for (const s of slots ?? []) {
    const list = byProfile.get(s.profile_id as string) ?? []
    list.push({
      date: s.date as string,
      start: toMinutes(s.start_time as string),
      end: toMinutes(s.end_time as string),
      repeatsWeekly: s.repeats_weekly as boolean,
      repeatUntil: (s.repeat_until as string | null) ?? null,
    })
    byProfile.set(s.profile_id as string, list)
  }
  return (profiles ?? [])
    .map(p => ({
      id: p.id as string,
      name: teamNames.get((p.email as string).toLowerCase()) ?? (p.email as string),
      slots: byProfile.get(p.id as string) ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
}
