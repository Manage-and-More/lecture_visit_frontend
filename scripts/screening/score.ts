/**
 * Computes the estimated-audience score of every lecture in a semester (both universities)
 * and stores it in lecture_scores. Run after each import.
 *
 *   npx tsx scripts/screening/score.ts "WiSe 2026/27"           # dry run: prints the top lectures
 *   npx tsx scripts/screening/score.ts "WiSe 2026/27" --apply   # writes lecture_scores
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_KEY (e.g. set -a; source ../tum_scraper/.env; set +a).
 */
import '../outreach/env'
import { createAdminClient } from '@/lib/supabase/admin'
import { scoreLecture, type ProgramLink } from '@/lib/screening/score'

type Row = {
  id: string
  title: string
  lecture_type: string | null
  university: { name: string } | null
  lecture_schedules: { location: string | null }[]
  lecture_professors: { professor: { email: string | null } | null }[]
  lecture_study_programs: {
    lecture_obligation: string | null
    recommended_semester: number | null
    program: { id: string; name: string; degree_type: string | null; student_count: number | null } | null
  }[]
}

async function main() {
  const semester = process.argv[2]
  const apply = process.argv.includes('--apply')
  if (!semester) throw new Error('Usage: score.ts "<semester>" [--apply]')
  const winter = semester.startsWith('WiSe')
  const db = createAdminClient()

  const rows: Row[] = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await db.from('lectures')
      .select('id, title, lecture_type, university:universities(name), lecture_schedules(location), lecture_professors(professor:professors(email)), lecture_study_programs(lecture_obligation, recommended_semester, program:study_programs(id, name, degree_type, student_count))')
      .eq('semester', semester)
      .order('id')
      .range(from, from + 499)
    if (error) throw error
    rows.push(...((data ?? []) as unknown as Row[]))
    if (!data || data.length < 500) break
  }

  const scored = rows.map(r => {
    const links: ProgramLink[] = r.lecture_study_programs
      .filter(l => l.program)
      .map(l => ({
        programId: l.program!.id,
        programName: l.program!.name,
        degreeType: l.program!.degree_type,
        obligation: l.lecture_obligation,
        semester: l.recommended_semester,
        studentCount: l.program!.student_count,
      }))
    const s = scoreLecture({
      title: r.title,
      lectureType: r.lecture_type,
      locations: r.lecture_schedules.map(x => x.location ?? ''),
      links,
    }, winter)
    return {
      row: r,
      record: {
        lecture_id: r.id,
        semester,
        score: s.score,
        reasons: s.reasons,
        program_count: s.programCount,
        mandatory_count: s.mandatoryCount,
        has_email: r.lecture_professors.some(lp => lp.professor?.email?.trim()),
        in_lecture_hall: s.inLectureHall,
        computed_at: new Date().toISOString(),
      },
    }
  })

  for (const uni of ['TUM', 'LMU']) {
    const list = scored.filter(s => s.row.university?.name === uni).sort((a, b) => b.record.score - a.record.score)
    console.log(`\n${uni}: ${list.length} lectures, ${list.filter(s => s.record.program_count > 0).length} with programs`)
    for (const s of list.slice(0, 15)) {
      console.log(`  ${s.record.score.toFixed(1).padStart(5)}  ${s.row.title.slice(0, 55).padEnd(55)}  ${s.record.reasons.slice(0, 2).join(' | ').slice(0, 110)}`)
    }
  }

  if (!apply) {
    console.log('\nDry run: nothing written. Add --apply to write lecture_scores.')
    return
  }
  for (let i = 0; i < scored.length; i += 500) {
    const { error } = await db.from('lecture_scores').upsert(scored.slice(i, i + 500).map(s => s.record), { onConflict: 'lecture_id' })
    if (error) throw error
  }
  console.log(`\nStored ${scored.length} scores.`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
