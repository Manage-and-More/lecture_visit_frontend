/**
 * Picks the lectures to visit that reach the most distinct students (model and assumptions:
 * src/lib/screening/optimize.ts). Read-only: prints the result, optionally writes a CSV.
 *
 *   npm run -s screening:optimize -- [--visits=20] [--university=all|TUM|LMU]
 *       [--semester="WiSe 2026/27"] [--csv=/path/out.csv] [--include-past]
 *       [--min=LMU:10,TUM:10] [--registrations=file.json] [--rooms=file.json] [--lmu-sections=file.csv]
 *
 * Only lectures with at least one lecturer email and (unless --include-past) a session left.
 * Needs SUPABASE_URL / SUPABASE_SERVICE_KEY (../tum_scraper/.env is loaded automatically).
 */
import '../mail-bridge/load-env'
import '../outreach/env'
import { writeFileSync } from 'node:fs'
import { createAdminClient } from '@/lib/supabase/admin'
import { extrapolateDates } from '@/lib/date-utils'
import { DEFAULT_PARAMS, optimize } from '@/lib/screening/optimize'
import { cleanLectureType, truncateLabel } from '@/lib/screening/score'
import type { LectureSchedule } from '@/types/database'
import { attachAudienceData, defaultDataPaths, type DataLecture } from './audience-data'

const arg = (name: string) => process.argv.slice(2).find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const visits = Number(arg('visits') ?? DEFAULT_PARAMS.visits)
const university = arg('university') ?? 'all'
const semester = arg('semester') ?? 'WiSe 2026/27'
const csvPath = arg('csv')
const includePast = process.argv.includes('--include-past')
// Registered students per lecture (TUMonline), as {lecture_id: count}; optional
// Defaults: ../lecture_visit_data/<semester>/ and ../lmu_scraper/data/<semester>/ (see audience-data.ts)
const defaults = defaultDataPaths(semester)
const registrationsPath = arg('registrations') ?? defaults.registrations
// Seats per room location string, as {location: seats}; optional (LMU rooms)
const roomsPath = arg('rooms') ?? defaults.rooms
// LMU lecture list with faculties (lmu_scraper data/<semester>/lecture_sections.csv); optional
const sectionsPath = arg('lmu-sections') ?? defaults.sections

// Minimum visits per university, e.g. --min=LMU:10,TUM:10
const minPerUniversity = Object.fromEntries((arg('min') ?? '').split(',').filter(Boolean)
  .map(x => x.split(':')).map(([u, n]) => [u, Number(n)]))

type Row = {
  id: string; title: string; lecture_type: string | null; external_id: string | null
  university: { name: string } | null
  lecture_schedules: LectureSchedule[]
  lecture_professors: { professor: { email: string | null } | null }[]
  lecture_study_programs: { lecture_obligation: string | null; recommended_semester: number | null; program: { name: string; degree_type: string | null } | null }[]
}

async function main() {
  const db = createAdminClient()
  const rows: Row[] = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await db.from('lectures')
      .select('id, title, lecture_type, external_id, university:universities(name), lecture_schedules(*), lecture_professors(professor:professors(email)), lecture_study_programs(lecture_obligation, recommended_semester, program:study_programs(name, degree_type))')
      .eq('semester', semester).order('id').range(from, from + 499)
    if (error) throw error
    rows.push(...((data ?? []) as unknown as Row[]))
    if (!data || data.length < 500) break
  }
  const soon = new Date(); soon.setDate(soon.getDate() + 2)
  const counts = { all: rows.length, email: 0, sessions: 0 }
  const lectures: (DataLecture & { next: string | null; sessions: number })[] = []
  for (const r of rows) {
    if (university !== 'all' && r.university?.name !== university) continue
    if (!r.lecture_professors.some(lp => lp.professor?.email?.trim())) continue
    counts.email++
    const upcoming = extrapolateDates(r.lecture_schedules, 0, 30).filter(d => d.date >= soon)
    if (!includePast && upcoming.length === 0) continue
    counts.sessions++
    lectures.push({
      id: r.id, title: r.title, university: r.university?.name ?? '', lectureType: r.lecture_type, externalId: r.external_id,
      links: r.lecture_study_programs.filter(l => l.program).map(l => ({
        programName: l.program!.name, degreeType: l.program!.degree_type, obligation: l.lecture_obligation, semester: l.recommended_semester,
      })),
      next: upcoming[0]?.label ?? null, sessions: upcoming.length,
      locations: [...new Set(r.lecture_schedules.map(s => s.location).filter((x): x is string => Boolean(x)))],
    })
  }

  attachAudienceData(lectures, { registrations: registrationsPath, rooms: roomsPath, sections: sectionsPath })
  const t0 = Date.now()
  const result = optimize(lectures, { visits, winter: semester.startsWith('WiSe'), minPerUniversity })
  const ms = Date.now() - t0

  console.log(`${semester}, ${university === 'all' ? 'TUM and LMU' : university}: ${counts.all} lectures, ${counts.email} with a lecturer email, ${counts.sessions} with sessions left`)
  console.log(`Model: ${result.candidates} candidate lectures (Vorlesungen with program links), ${result.cohorts} cohorts, ~${Math.round(result.population).toLocaleString('de-DE')} students in the model`)
  console.log(`Solved in ${ms} ms (greedy + ${result.swaps} improving swaps)\n`)
  if (Object.keys(minPerUniversity).length) console.log(`Minimum per university: ${JSON.stringify(minPerUniversity)}; picked: ${JSON.stringify(result.picks.reduce((c, x) => ({ ...c, [x.lecture.university]: ((c as Record<string, number>)[x.lecture.university] ?? 0) + 1 }), {}))}`)
  console.log(`${visits} visits reach ~${Math.round(result.total).toLocaleString('de-DE')} distinct students (optimum at most ~${Math.round(result.upperBound).toLocaleString('de-DE')})\n`)
  let cumulative = 0
  result.picks.forEach((p, i) => {
    cumulative += p.gain
    const mandatory = p.programs.filter(x => x.obligation === 'mandatory')
    const shown = (mandatory.length ? mandatory : p.programs).slice(0, 3).map(x => `${truncateLabel(x.name, 34)}${x.years ? ` ${x.years}` : ''}`).join('; ')
    console.log(`${String(i + 1).padStart(2)}. +${String(Math.round(p.gain)).padStart(4)} (Σ ${String(Math.round(cumulative)).padStart(5)}) [${p.lecture.university}] ${truncateLabel(p.lecture.title, 62)}${p.lecture.registered != null ? ` · ${p.lecture.registered} registered` : p.lecture.roomSeats ? ` · room ${p.lecture.roomSeats} seats` : ''}`)
    console.log(`      ${p.programs.length} programs, ${mandatory.length} mandatory: ${shown}${p.programs.length > 3 ? ' …' : ''}`)
  })

  if (csvPath) {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [['rank', 'lecture_id', 'university', 'title', 'type', 'registered', 'room_seats', 'added_students', 'cumulative', 'audience_alone', 'programs', 'mandatory_in', 'next_session', 'sessions_left'].join(',')]
    let sum = 0
    result.picks.forEach((p, i) => {
      sum += p.gain
      const l = p.lecture as (typeof lectures)[number]
      lines.push([i + 1, l.id, l.university, l.title, cleanLectureType(l.lectureType), l.registered ?? '', l.roomSeats ?? '', Math.round(p.gain), Math.round(sum), Math.round(p.audience),
        p.programs.map(x => x.name).join('; '), p.programs.filter(x => x.obligation === 'mandatory').map(x => `${x.name}${x.years ? ` (${x.years} sem)` : ''}`).join('; '),
        l.next, l.sessions].map(esc).join(','))
    })
    writeFileSync(csvPath, '﻿' + lines.join('\n'))
    console.log(`\nCSV: ${csvPath}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
