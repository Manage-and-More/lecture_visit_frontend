'use server'

import { revalidatePath } from 'next/cache'
import { activeSemester, requireAdmin, requireUser } from '@/lib/auth'
import { extrapolateDates } from '@/lib/date-utils'
import { shortProgramName } from '@/lib/screening/score'
import type { LectureSchedule } from '@/types/database'

export type ScreeningFilters = {
  search: string
  university: 'all' | 'TUM' | 'LMU'
  onlyVorlesung: boolean
  onlyWithEmail: boolean
  onlyRelevant: boolean
  page: number
}

export type ScreeningProgram = { name: string; mandatory: boolean; semester: number | null; reached: boolean }

export type ScreeningRow = {
  id: string
  title: string
  university: string
  lectureType: string | null
  relevant: boolean
  score: number
  reasons: string[]
  hasEmail: boolean
  nextSession: string | null
  programs: ScreeningProgram[]
  newPrograms: number
}

export type ScreeningPage = {
  semester: string
  rows: ScreeningRow[]
  total: number
  pageSize: number
  coverage: { relevantLectures: number; programsReached: number; mandatoryPrograms: number }
  scored: boolean
}

const PAGE_SIZE = 50

type ProgramLinkRow = {
  lecture_obligation: string | null
  recommended_semester: number | null
  program: { id: string; name: string } | null
}

/** Programs a set of links reaches, by display name (curriculum versions merged). */
function programsOf(links: ProgramLinkRow[]) {
  const map = new Map<string, { mandatory: boolean; semester: number | null }>()
  for (const l of links) {
    if (!l.program) continue
    const name = shortProgramName(l.program.name)
    const current = map.get(name)
    const mandatory = l.lecture_obligation === 'mandatory'
    const semester = l.recommended_semester
    if (!current) map.set(name, { mandatory, semester })
    else map.set(name, {
      mandatory: current.mandatory || mandatory,
      semester: current.semester && semester ? Math.min(current.semester, semester) : current.semester ?? semester,
    })
  }
  return map
}

export async function getScreeningPage(filters: ScreeningFilters): Promise<ScreeningPage> {
  const { supabase } = await requireUser()
  const semester = await activeSemester(supabase)

  // Coverage of the lectures marked relevant: which programs a visit there reaches
  const { data: relevantRows } = await supabase.from('lectures')
    .select('id, lecture_study_programs(lecture_obligation, recommended_semester, program:study_programs(id, name))')
    .eq('semester', semester).eq('is_starred', true)
  const reached = new Map<string, boolean>() // program name -> reached through a mandatory lecture
  for (const r of (relevantRows ?? []) as unknown as { lecture_study_programs: ProgramLinkRow[] }[]) {
    for (const [name, p] of programsOf(r.lecture_study_programs)) reached.set(name, (reached.get(name) ?? false) || p.mandatory)
  }

  let universityId: string | null = null
  if (filters.university !== 'all') {
    const { data } = await supabase.from('universities').select('id').eq('name', filters.university).single()
    universityId = data?.id ?? null
  }

  let query = supabase.from('lecture_scores')
    .select('score, reasons, has_email, lecture:lectures!inner(id, title, lecture_type, is_starred, university_id, university:universities(name), lecture_schedules(*), lecture_study_programs(lecture_obligation, recommended_semester, program:study_programs(id, name)))', { count: 'exact' })
    .eq('semester', semester)
  if (universityId) query = query.eq('lecture.university_id', universityId)
  if (filters.search.trim()) query = query.ilike('lecture.title', `%${filters.search.trim()}%`)
  if (filters.onlyVorlesung) query = query.ilike('lecture.lecture_type', '%vorlesung%')
  if (filters.onlyWithEmail) query = query.eq('has_email', true)
  if (filters.onlyRelevant) query = query.eq('lecture.is_starred', true)
  const from = Math.max(0, filters.page) * PAGE_SIZE
  const { data, count, error } = await query
    .order('score', { ascending: false })
    .order('lecture_id')
    .range(from, from + PAGE_SIZE - 1)
  if (error) throw error

  type Row = {
    score: number
    reasons: string[]
    has_email: boolean
    lecture: {
      id: string; title: string; lecture_type: string | null; is_starred: boolean | null
      university: { name: string } | null
      lecture_schedules: LectureSchedule[]
      lecture_study_programs: ProgramLinkRow[]
    }
  }
  const rows: ScreeningRow[] = ((data ?? []) as unknown as Row[]).map(r => {
    const programs: ScreeningProgram[] = [...programsOf(r.lecture.lecture_study_programs).entries()]
      .map(([name, p]) => ({ name, mandatory: p.mandatory, semester: p.semester, reached: reached.has(name) }))
      .sort((a, b) => Number(b.mandatory) - Number(a.mandatory) || (a.semester ?? 99) - (b.semester ?? 99) || a.name.localeCompare(b.name))
    return {
      id: r.lecture.id,
      title: r.lecture.title,
      university: r.lecture.university?.name ?? '',
      lectureType: r.lecture.lecture_type,
      relevant: !!r.lecture.is_starred,
      score: Number(r.score),
      reasons: r.reasons,
      hasEmail: r.has_email,
      nextSession: extrapolateDates(r.lecture.lecture_schedules, 0, 20)[0]?.label ?? null,
      programs,
      newPrograms: r.lecture.is_starred ? 0 : programs.filter(p => !p.reached).length,
    }
  })

  const { count: scoredCount } = await supabase.from('lecture_scores')
    .select('lecture_id', { count: 'exact', head: true }).eq('semester', semester)

  return {
    semester,
    rows,
    total: count ?? 0,
    pageSize: PAGE_SIZE,
    coverage: {
      relevantLectures: relevantRows?.length ?? 0,
      programsReached: reached.size,
      mandatoryPrograms: [...reached.values()].filter(Boolean).length,
    },
    scored: (scoredCount ?? 0) > 0,
  }
}

/** Marks a lecture as relevant for outreach (or not). Relevant lectures are outreach targets. */
export async function setLectureRelevant(lectureId: string, relevant: boolean): Promise<void> {
  const { supabase } = await requireAdmin()
  const { error } = await supabase.from('lectures').update({ is_starred: relevant }).eq('id', lectureId)
  if (error) throw error
  revalidatePath('/lectures')
}
