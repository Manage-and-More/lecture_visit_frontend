import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { activeSemester } from '@/lib/auth'
import { cleanLectureType, shortProgramName } from '@/lib/screening/score'

export const dynamic = 'force-dynamic'

type Kind = 'lectures' | 'sessions' | 'programs'

type Row = {
  id: string
  external_id: string | null
  title: string
  lecture_type: string | null
  semester: string | null
  source_url: string | null
  university: { name: string } | null
  lecture_schedules: { day_time: string | null; frequency: string | null; date_range: string | null; location: string | null }[]
  lecture_professors: { professor: { title: string | null; first_name: string | null; last_name: string | null; email: string | null } | null }[]
  lecture_study_programs: { lecture_obligation: string | null; recommended_semester: number | null; program: { name: string; degree_type: string | null } | null }[]
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",;\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function toCsv(header: string[], rows: unknown[][]): string {
  // BOM so Excel opens UTF-8 (umlauts) correctly
  return '﻿' + [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/**
 * The scraped lecture data as CSV, for everyone signed in (the team is trusted; the file
 * includes lecturer email addresses).
 *   ?kind=lectures  one row per lecture (lecturers, sessions and programs summarized)
 *   ?kind=sessions  one row per time slot
 *   ?kind=programs  one row per lecture and study program
 *   &university=all|TUM|LMU   &targets=1 (only the shared target list)
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const params = request.nextUrl.searchParams
  const kind = (['lectures', 'sessions', 'programs'].includes(params.get('kind') ?? '') ? params.get('kind') : 'lectures') as Kind
  const university = params.get('university') ?? 'all'
  const targetsOnly = params.get('targets') === '1'
  const semester = await activeSemester(supabase)

  let universityId: string | null = null
  if (university === 'TUM' || university === 'LMU') {
    const { data } = await supabase.from('universities').select('id').eq('name', university).single()
    universityId = data?.id ?? null
  }

  const targets = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from('target_lectures').select('lecture_id').order('lecture_id').range(from, from + 999)
    for (const t of data ?? []) targets.add(t.lecture_id as string)
    if (!data || data.length < 1000) break
  }
  // Paged: a request returns at most 1,000 rows
  const scores = new Map<string, number>()
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from('lecture_scores').select('lecture_id, score').eq('semester', semester).order('lecture_id').range(from, from + 999)
    for (const s of data ?? []) scores.set(s.lecture_id as string, Number(s.score))
    if (!data || data.length < 1000) break
  }

  const lectures: Row[] = []
  for (let from = 0; ; from += 500) {
    let query = supabase.from('lectures')
      .select('id, external_id, title, lecture_type, semester, source_url, university:universities(name), lecture_schedules(day_time, frequency, date_range, location), lecture_professors(professor:professors(title, first_name, last_name, email)), lecture_study_programs(lecture_obligation, recommended_semester, program:study_programs(name, degree_type))')
      .eq('semester', semester)
      .order('id')
      .range(from, from + 499)
    if (universityId) query = query.eq('university_id', universityId)
    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    lectures.push(...((data ?? []) as unknown as Row[]))
    if (!data || data.length < 500) break
  }
  const selected = (targetsOnly ? lectures.filter(l => targets.has(l.id)) : lectures)
    .sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0))

  const name = (p: { title: string | null; first_name: string | null; last_name: string | null }) =>
    [p.title, p.first_name, p.last_name].filter(Boolean).join(' ')
  const base = (l: Row) => [l.university?.name ?? '', l.external_id ?? '', l.title]

  let csv: string
  if (kind === 'sessions') {
    csv = toCsv(
      ['university', 'number', 'title', 'day_time', 'frequency', 'date_range', 'location'],
      selected.flatMap(l => l.lecture_schedules.map(s => [...base(l), s.day_time, s.frequency, s.date_range, s.location])),
    )
  } else if (kind === 'programs') {
    csv = toCsv(
      ['university', 'number', 'title', 'program', 'degree', 'obligation', 'recommended_semester'],
      selected.flatMap(l => l.lecture_study_programs.filter(p => p.program).map(p => [
        ...base(l), shortProgramName(p.program!.name), p.program!.degree_type, p.lecture_obligation, p.recommended_semester,
      ])),
    )
  } else {
    csv = toCsv(
      ['university', 'number', 'title', 'type', 'semester', 'target', 'score', 'lecturers', 'lecturer_emails', 'sessions', 'programs', 'mandatory_in', 'source_url'],
      selected.map(l => {
        const profs = l.lecture_professors.map(lp => lp.professor).filter((p): p is NonNullable<typeof p> => Boolean(p))
        const programs = [...new Set(l.lecture_study_programs.filter(p => p.program).map(p => shortProgramName(p.program!.name)))]
        const mandatory = [...new Set(l.lecture_study_programs.filter(p => p.program && p.lecture_obligation === 'mandatory').map(p => shortProgramName(p.program!.name)))]
        return [
          ...base(l),
          cleanLectureType(l.lecture_type),
          l.semester,
          targets.has(l.id) ? 'yes' : 'no',
          scores.get(l.id)?.toFixed(1) ?? '',
          profs.map(name).join('; '),
          profs.map(p => p.email).filter(Boolean).join('; '),
          l.lecture_schedules.map(s => [s.day_time, s.date_range, s.location].filter(Boolean).join(' | ')).join('; '),
          programs.join('; '),
          mandatory.join('; '),
          l.source_url,
        ]
      }),
    )
  }

  const scope = [university === 'all' ? 'lmu-tum' : university.toLowerCase(), targetsOnly ? 'targets' : 'all'].join('-')
  const file = `lectures-${kind}-${semester.replace(/[^\w]+/g, '-').toLowerCase()}-${scope}.csv`
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file}"`,
      'Cache-Control': 'no-store',
    },
  })
}
