import type { SupabaseClient } from '@supabase/supabase-js'
import { extrapolateDates } from '@/lib/date-utils'
import { loadMembers } from '@/lib/scheduling/calendar'
import { covers, toMinutes } from '@/lib/scheduling/time'
import type { LectureSchedule } from '@/types/database'

type Db = SupabaseClient

type ProfessorRow = {
  id: string
  first_name: string | null
  last_name: string | null
  title: string | null
  email: string | null
}

export type TargetLecture = {
  id: string
  title: string
  lectureType: string | null
  nextSession: string | null // label, e.g. "Di. 17.11.2026, 10:15 - 11:45"
  /** First upcoming session where team members are free, and who */
  match: { label: string; members: string[] } | null
  /** How many upcoming sessions fit at least one team member */
  matchingSessions: number
}

export type TargetCandidate = {
  professorId: string
  name: string
  title: string | null
  email: string
  cc: { professorId: string; email: string }[]
  lectures: TargetLecture[]
  warnings: string[]
}

export type TargetResult = {
  semester: string
  candidates: TargetCandidate[]
  skipped: { reason: string; count: number }[]
  /** Team members who confirmed their availability */
  membersWithAvailability: number
  /** Target lectures of this semester on the shared list */
  targetCount: number
  onlyMatching: boolean
}

/** A member counts as free for a visit if their availability covers 30 minutes from the start. */
const VISIT_WINDOW_MINUTES = 30

const CHUNK = 150

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await build(from, from + 999)
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) return rows
  }
}

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function displayName(p: ProfessorRow): string {
  return [p.title, p.first_name, p.last_name].filter(Boolean).join(' ')
}

/**
 * Lecturers to email this semester: the target lectures chosen on the Lectures page (the
 * shared list) that still have sessions left and, if asked, a session where a team member
 * with confirmed availability is free. One candidate per lecturer, who gets one email
 * covering all their target lectures.
 */
export async function findTargets(
  db: Db, semester: string, options: { onlyMatching: boolean } = { onlyMatching: true },
): Promise<TargetResult> {
  const skipped = new Map<string, number>()
  // Only committed availability counts
  const members = (await loadMembers(db)).filter(m => m.confirmed && m.slots.length > 0)
  const skip = (reason: string, n = 1) => skipped.set(reason, (skipped.get(reason) ?? 0) + n)

  const targets = await fetchAll<{ lecture_id: string }>((from, to) =>
    db.from('target_lectures').select('lecture_id').range(from, to))
  const lectureIds = new Set(targets.map(t => t.lecture_id))

  type LectureRow = {
    id: string
    title: string
    lecture_type: string | null
    schedules: LectureSchedule[]
    lecture_professors: { professor: ProfessorRow | null }[]
  }
  const lectures: LectureRow[] = []
  for (const ids of chunks([...lectureIds])) {
    const { data } = await db.from('lectures')
      .select('id, title, lecture_type, schedules:lecture_schedules(*), lecture_professors(professor:professors(id, first_name, last_name, title, email))')
      .in('id', ids)
      .eq('semester', semester)
    lectures.push(...((data ?? []) as unknown as LectureRow[]))
  }

  const { data: optedOutRows } = await db.from('do_not_contact').select('email')
  const optedOut = new Set((optedOutRows ?? []).map(r => r.email as string))
  const { data: existingRows } = await db.from('professor_outreach')
    .select('professor_id').eq('semester', semester).neq('status', 'cancelled')
  const alreadyContacted = new Set((existingRows ?? []).map(r => r.professor_id as string))

  const soon = new Date()
  soon.setDate(soon.getDate() + 2)

  const byProfessor = new Map<string, TargetCandidate>()
  for (const lecture of lectures) {
    const upcoming = extrapolateDates(lecture.schedules, 0, 20).filter(d => d.date >= soon)
    const hasSchedule = lecture.schedules.some(s => s.day_time)
    if (hasSchedule && upcoming.length === 0) {
      skip('No sessions left this semester')
      continue
    }

    // Step 3 of the workflow: sessions that fall into someone's availability
    const matching = upcoming
      .map(s => {
        const start = toMinutes(s.startTime)
        return { session: s, free: members.filter(m => covers(m.slots, s.date, start, start + VISIT_WINDOW_MINUTES)) }
      })
      .filter(x => x.free.length > 0)
    if (options.onlyMatching && matching.length === 0) {
      skip("No session fits anyone's availability")
      continue
    }

    const professors = lecture.lecture_professors
      .map(lp => lp.professor)
      .filter((p): p is ProfessorRow => Boolean(p))
    const withEmail = professors.filter(p => p.email)
    if (withEmail.length === 0) {
      skip('No lecturer with an email address')
      continue
    }
    // The database doesn't keep the university's lecturer order, so a professor is preferred
    const primary = withEmail.find(p => /prof/i.test(p.title ?? '')) ?? withEmail[0]
    const email = primary.email!.trim().toLowerCase()
    if (optedOut.has(email)) {
      skip('Lecturer asked not to be contacted')
      continue
    }
    if (alreadyContacted.has(primary.id)) {
      skip('Lecturer already contacted this semester')
      continue
    }

    let candidate = byProfessor.get(primary.id)
    if (!candidate) {
      candidate = {
        professorId: primary.id,
        name: displayName(primary),
        title: primary.title,
        email,
        cc: [],
        lectures: [],
        warnings: [],
      }
      byProfessor.set(primary.id, candidate)
    }
    candidate.lectures.push({
      id: lecture.id,
      title: lecture.title,
      lectureType: lecture.lecture_type,
      nextSession: upcoming[0]?.label ?? null,
      match: matching[0] ? { label: matching[0].session.label, members: matching[0].free.map(m => m.name) } : null,
      matchingSessions: matching.length,
    })
    if (!hasSchedule && !candidate.warnings.includes('A lecture has no schedule')) {
      candidate.warnings.push('A lecture has no schedule')
    }
    for (const other of withEmail) {
      const otherEmail = other.email!.trim().toLowerCase()
      if (other.id !== primary.id && !optedOut.has(otherEmail) && !candidate.cc.some(c => c.email === otherEmail)) {
        candidate.cc.push({ professorId: other.id, email: otherEmail })
      }
    }
  }

  const candidates = [...byProfessor.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'))
  return {
    semester,
    candidates,
    skipped: [...skipped.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    membersWithAvailability: members.length,
    targetCount: lectures.length,
    onlyMatching: options.onlyMatching,
  }
}
