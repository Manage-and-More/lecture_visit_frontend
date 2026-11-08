import type { SupabaseClient } from '@supabase/supabase-js'
import { extrapolateDates } from '@/lib/date-utils'
import type { LectureSchedule, MailSettings } from '@/types/database'

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
}

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
 * Lectures to ask about this semester: mandatory lectures of starred study programs plus
 * starred lectures, of the configured type, with at least one session left. One candidate per
 * lecturer, who gets one email covering all their target lectures.
 */
export async function findTargets(db: Db, semester: string, settings: MailSettings): Promise<TargetResult> {
  const skipped = new Map<string, number>()
  const skip = (reason: string, n = 1) => skipped.set(reason, (skipped.get(reason) ?? 0) + n)

  const { data: programs } = await db.from('study_programs').select('id').eq('is_starred', true)
  const programIds = (programs ?? []).map(p => p.id as string)

  const lectureIds = new Set<string>()
  for (const ids of chunks(programIds)) {
    const links = await fetchAll<{ lecture_id: string }>((from, to) =>
      db.from('lecture_study_programs').select('lecture_id')
        .in('study_program_id', ids).eq('lecture_obligation', 'mandatory').range(from, to))
    links.forEach(l => lectureIds.add(l.lecture_id))
  }
  const starred = await fetchAll<{ id: string }>((from, to) =>
    db.from('lectures').select('id').eq('semester', semester).eq('is_starred', true).range(from, to))
  starred.forEach(l => lectureIds.add(l.id))

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

  const typeFilter = settings.lecture_type_filter.trim().toLowerCase()
  const soon = new Date()
  soon.setDate(soon.getDate() + 2)

  const byProfessor = new Map<string, TargetCandidate>()
  for (const lecture of lectures) {
    if (typeFilter && !(lecture.lecture_type ?? '').toLowerCase().includes(typeFilter)) {
      skip(`Lecture type isn't "${settings.lecture_type_filter}"`)
      continue
    }

    const upcoming = extrapolateDates(lecture.schedules, 0, 20).filter(d => d.date >= soon)
    const hasSchedule = lecture.schedules.some(s => s.day_time)
    if (hasSchedule && upcoming.length === 0) {
      skip('No sessions left this semester')
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
  }
}
