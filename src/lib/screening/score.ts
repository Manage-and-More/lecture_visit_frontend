/**
 * Estimated audience of a lecture, best effort. Neither TUM nor LMU publishes attendance, so
 * the score combines what the scraped data does have:
 *  - per study program the lecture belongs to: program size (student count if known, otherwise
 *    by degree), whether it's mandatory there, and the recommended semester (in a winter
 *    semester the 1st/3rd-semester cohorts attend in full),
 *  - the lecture type (a Vorlesung is attended by the whole cohort, seminars by few),
 *  - a lecture hall in the room name.
 * Teacher-training (Lehramt, B.Ed./M.Ed.) and minor-subject variants, and electives open to many
 * programs, are capped: they are many small audiences and would otherwise outweigh one large
 * Bachelor cohort that has the lecture as a mandatory course.
 */

export type ProgramLink = {
  programId: string
  programName: string
  degreeType: string | null
  obligation: string | null
  semester: number | null
  studentCount: number | null
}

export type LectureInput = {
  title: string
  lectureType: string | null
  locations: string[]
  links: ProgramLink[]
}

export type LectureScore = {
  score: number
  reasons: string[]
  programCount: number
  mandatoryCount: number
  inLectureHall: boolean
}

const TEACHING_RE = /lehramt|teacher|teaching|unterrichtsfach|didaktikfach|berufliche bildung|gymnasi|realschul|grundschul|mittelschul|of education|\b[BM]\.\s?Ed\b|\bsubject\b/i
const MINOR_RE = /nebenfach|\bminor\b|\bNF\b/i
const HALL_RE = /hörsaal|hoersaal|audimax|\bHS\s?\d|\bHS\b|\baula\b|interims/i

/** "Informatics [20261], Bachelor of Science" -> "Informatics (B.Sc.)"; "Bachelor Physik" -> "Physik (Bachelor)". */
export function shortProgramName(name: string): string {
  let n = name.replace(/\s*\[[^\]]*\]/g, '').trim()
  const degrees: [RegExp, string][] = [
    [/,\s*Bachelor of Science.*$/i, 'B.Sc.'], [/,\s*Master of Science.*$/i, 'M.Sc.'],
    [/,\s*Bachelor of Arts.*$/i, 'B.A.'], [/,\s*Master of Arts.*$/i, 'M.A.'],
    [/,\s*Bachelor of Education.*$/i, 'B.Ed.'], [/,\s*Master of Education.*$/i, 'M.Ed.'],
    [/,\s*Bachelor of Engineering.*$/i, 'B.Eng.'], [/,\s*Master of Engineering.*$/i, 'M.Eng.'],
    [/,\s*(State Examination|Staatsexamen).*$/i, 'Staatsexamen'],
  ]
  for (const [re, abbr] of degrees) {
    if (re.test(n)) return `${n.replace(re, '').trim()} (${abbr})`
  }
  const lead = n.match(/^(Bachelor|Master|Staatsexamen|Lehramt)\s+(.+)$/i)
  if (lead) return `${lead[2]} (${lead[1][0].toUpperCase()}${lead[1].slice(1).toLowerCase()})`
  n = n.replace(/,\s*$/, '')
  return n
}

function programBase(link: ProgramLink): number {
  if (link.studentCount && link.studentCount > 0) {
    // ~300 students per program counts as 1; very large programs are dampened
    return Math.min(4, Math.sqrt(link.studentCount / 300))
  }
  const d = (link.degreeType ?? '').toLowerCase()
  if (d.startsWith('bachelor') || d === 'staatsexamen') return 1
  if (d.startsWith('master')) return 0.5
  if (d === 'lehramt') return 0.3
  return 0.4
}

function obligationWeight(obligation: string | null): number {
  switch (obligation) {
    case 'mandatory': return 1
    case 'compulsory_elective': return 0.4
    case 'elective': return 0.1
    default: return 0.3
  }
}

/** Winter semesters run the odd semesters of a program, summer semesters the even ones. */
function semesterWeight(semester: number | null, winter: boolean): number {
  if (!semester) return 0.5
  const inCycle = (semester % 2 === 1) === winter
  if (!inCycle) return 0.25
  const position = winter ? (semester + 1) / 2 : semester / 2 // 1 = first semester of the cycle
  return position <= 1 ? 1 : position <= 2 ? 0.8 : position <= 3 ? 0.55 : 0.4
}

function typeWeight(lectureType: string | null): number {
  const t = (lectureType ?? '').toLowerCase()
  if (t.includes('integrierten') || t.includes('(vi)')) return 0.9
  if (t.includes('vorlesung') || t.includes('(vo)')) return 1
  if (t.includes('übung') || t.includes('(ue)') || t.includes('tutorium')) return 0.35
  if (t.includes('seminar') || t.includes('kolloquium') || t.includes('praktikum')) return 0.15
  return 0.3
}

function semesterLabel(semester: number | null): string {
  return semester ? `${semester}. semester` : ''
}

export function scoreLecture(lecture: LectureInput, winterSemester: boolean): LectureScore {
  // One entry per program, merging curriculum versions of the same program
  const byProgram = new Map<string, { label: string; weight: number; link: ProgramLink; group: 'teaching' | 'minor' | 'main' }>()
  for (const link of lecture.links) {
    const label = shortProgramName(link.programName)
    const weight = programBase(link) * obligationWeight(link.obligation) * semesterWeight(link.semester, winterSemester)
    const group = TEACHING_RE.test(link.programName) || link.degreeType === 'Lehramt' ? 'teaching'
      : MINOR_RE.test(link.programName) ? 'minor' : 'main'
    const current = byProgram.get(label)
    if (!current || weight > current.weight) byProgram.set(label, { label, weight, link, group })
  }
  const entries = [...byProgram.values()].sort((a, b) => b.weight - a.weight)
  const sum = (filter: (e: (typeof entries)[number]) => boolean) => entries.filter(filter).reduce((s, e) => s + e.weight, 0)
  const main = (e: (typeof entries)[number]) => e.group === 'main'
  const audience =
    sum(e => main(e) && e.link.obligation === 'mandatory') +
    Math.min(1.5, sum(e => main(e) && e.link.obligation === 'compulsory_elective')) +
    // LMU lists most lectures under a program without saying whether they are mandatory
    Math.min(1.5, sum(e => main(e) && (e.link.obligation === 'unknown' || !e.link.obligation))) +
    Math.min(0.6, sum(e => main(e) && e.link.obligation === 'elective')) +
    Math.min(1, sum(e => e.group === 'teaching')) +
    Math.min(0.5, sum(e => e.group === 'minor'))

  const inLectureHall = lecture.locations.some(l => HALL_RE.test(l))
  const raw = audience * typeWeight(lecture.lectureType) * (inLectureHall ? 1.3 : 1)
  // Lectures without any program info still get a small type/hall-based score
  const score = Math.round((raw > 0 ? raw : 0.1 * typeWeight(lecture.lectureType) * (inLectureHall ? 2 : 1)) * 100) / 10

  const reasons: string[] = []
  // Reasons name the programs that matter most: main programs first, then the rest
  const ranked = [...entries].sort((a, b) => Number(b.group === 'main') - Number(a.group === 'main') || b.weight - a.weight)
  for (const e of ranked.slice(0, 3)) {
    if (e.weight < 0.05) continue
    const status = e.link.obligation === 'mandatory' ? 'Mandatory' : e.link.obligation === 'compulsory_elective' ? 'Compulsory elective'
      : e.link.obligation === 'elective' ? 'Elective' : 'Listed'
    reasons.push([status, semesterLabel(e.link.semester), e.label].filter(Boolean).join(', '))
  }
  if (entries.length > 3) reasons.push(`+${entries.length - 3} more programs`)
  if (inLectureHall) reasons.push('Lecture hall')
  if (entries.length === 0) reasons.push('No program information')

  return {
    score,
    reasons,
    programCount: entries.length,
    mandatoryCount: entries.filter(e => e.link.obligation === 'mandatory').length,
    inLectureHall,
  }
}
