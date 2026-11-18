/**
 * Which lectures to visit so that as many different students as possible hear about Manage
 * and More, with a fixed number of visits.
 *
 * Model
 *  - Students are grouped into cohorts: one per study program and study year (Bachelor
 *    years 1-3, Master years 1-2, ...). Curriculum versions of a program are merged by name.
 *    No program publishes student numbers, so a cohort's size comes from its degree type
 *    (see CohortSizes); teacher-training and minor/exchange variants count as small cohorts.
 *  - A lecture reaches each student of a linked cohort with some probability, depending on
 *    how the lecture is listed in that program: mandatory, compulsory elective, elective or
 *    unknown (Attendance). A known recommended semester points at one study year; in a
 *    winter semester the odd semesters are "in cycle", an even one means mostly repeaters
 *    (offCycleFactor). Without a semester, the lecture reaches every year of the program.
 *  - Where TUMonline shows how many students registered for a lecture, the lecture's audience
 *    is set to that number times registeredShowUp, spread over its cohorts in proportion to
 *    the model's own estimate; a cohort that turns out too small for that is enlarged. Other
 *    lectures with a known room size (LMU) get seats * roomFill; lectures with neither are
 *    capped at unknownAudienceCap, so a broad elective
 *    listed in 100 programs can't count as thousands of listeners.
 *  - Students are reached independently by different lectures, so the expected number of
 *    distinct students reached by a set S of lectures is
 *        f(S) = sum over cohorts g of  N_g * (1 - prod over l in S of (1 - p_lg))
 *    Two lectures for the same cohort add less than their sum; that's what makes the
 *    solution spread over programs.
 *
 * Solver
 *  f is monotone submodular, so greedy selection is within (1 - 1/e) of the optimum. On top:
 *  lazy evaluation (fast greedy), then 1-swap local search until no swap improves, and an
 *  upper bound on the optimum (f(S) + sum of the k largest marginal gains w.r.t. S) that
 *  shows how far from optimal the result can at most be.
 */
import { MINOR_RE, TEACHING_RE, cleanLectureType, shortProgramName } from './score'

export type Attendance = { mandatory: number; compulsory_elective: number; elective: number; unknown: number }
export type CohortSizes = Record<'Bachelor' | 'Staatsexamen' | 'Master' | 'Lehramt' | 'Berufliche Bildung' | 'Other' | 'teaching' | 'minor', number>

export type OptimizeParams = {
  visits: number
  /** Share of a cohort that sits in one lecture session, by how the lecture is listed */
  attendance: Attendance
  /** Students per study year, by degree type */
  cohortSize: CohortSizes
  /** Study years per degree type (Bachelor 3, Master 2, ...) */
  years: Record<string, number>
  /** Recommended semester outside the current cycle (e.g. 2nd semester in winter) */
  offCycleFactor: number
  /** Lecture type weight; types not matched count as `otherType` (0 = left out) */
  vorlesung: number
  integrated: number
  otherType: number
  winter: boolean
  /** Share of the registered students who sit in a given session */
  registeredShowUp: number
  /** Largest audience assumed for a lecture without a registration count */
  unknownAudienceCap: number
  /** Share of the seats taken, for lectures where only the room size is known */
  roomFill: number
  /**
   * Factor on the degree-based cohort sizes per university, so that the modelled first-year
   * students add up to the official count (Bayerisches Landesamt für Statistik, Statistischer
   * Bericht B3110C 202422, table 3.1: students in their 1st subject semester, WiSe 2024/25:
   * LMU 15,912, TUM 13,962; the unscaled model has 42,695 and 22,400).
   */
  cohortScale: Record<string, number>
  /** Minimum number of visits per university, e.g. { LMU: 10, TUM: 10 } */
  minPerUniversity: Record<string, number>
}

export const DEFAULT_PARAMS: OptimizeParams = {
  visits: 20,
  attendance: { mandatory: 0.6, compulsory_elective: 0.25, elective: 0.04, unknown: 0.12 },
  cohortSize: { Bachelor: 200, Staatsexamen: 200, Master: 100, Lehramt: 40, 'Berufliche Bildung': 30, Other: 30, teaching: 25, minor: 15 },
  years: { Bachelor: 3, Staatsexamen: 3, Master: 2, Lehramt: 3, 'Berufliche Bildung': 2, Other: 1 },
  offCycleFactor: 0.25,
  vorlesung: 1,
  integrated: 0.9,
  otherType: 0,
  winter: true,
  registeredShowUp: 0.6,
  unknownAudienceCap: 150,
  roomFill: 0.6,
  cohortScale: { LMU: 15912 / 42695, TUM: 13962 / 22400 },
  minPerUniversity: {},
}

export type LectureLink = {
  programName: string
  degreeType: string | null
  obligation: string | null
  semester: number | null
}

export type OptLecture = { id: string; title: string; university: string; lectureType: string | null; links: LectureLink[]; registered?: number | null; roomSeats?: number | null
  /** Student pool for a lecture without program links (e.g. its LMU faculty), so such lectures overlap */
  pool?: { key: string; size: number } | null }

export type Cohort = { key: string; program: string; year: number | null; size: number }

export type Pick = {
  lecture: OptLecture
  /** Expected distinct students this lecture adds, given the lectures picked before it */
  gain: number
  /** Expected students in the room (ignoring overlap with other picks) */
  audience: number
  programs: { name: string; obligation: string; years: string }[]
}

export type OptimizeResult = {
  picks: Pick[]
  total: number
  upperBound: number
  candidates: number
  cohorts: number
  population: number
  swaps: number
}

function degreeOf(link: LectureLink): keyof CohortSizes | null {
  const d = link.degreeType ?? 'Other'
  if (/doctor|promotion/i.test(d) || /promotion|doctoral|doktorand/i.test(link.programName)) return null
  if (TEACHING_RE.test(link.programName) || d === 'Lehramt') return d === 'Lehramt' ? 'Lehramt' : 'teaching'
  if (MINOR_RE.test(link.programName)) return 'minor'
  if (d === 'Bachelor' || d === 'Staatsexamen' || d === 'Master' || d === 'Berufliche Bildung') return d
  if (/bachelor/i.test(d)) return 'Bachelor'
  if (/master/i.test(d)) return 'Master'
  if (/staats|juristische/i.test(d)) return 'Staatsexamen'
  return 'Other'
}

function typeWeight(type: string | null, p: OptimizeParams): number {
  const t = (cleanLectureType(type) ?? '').toLowerCase()
  if (t.includes('integrierten') || t.includes('(vi)')) return p.integrated
  if (t.includes('vorlesung') || t.includes('(vo)')) return p.vorlesung
  return p.otherType
}

/** Turns lectures into sparse "reach" vectors over cohorts. */
export function buildModel(lectures: OptLecture[], p: OptimizeParams) {
  const cohorts = new Map<string, Cohort>()
  const cohortIndex = new Map<string, number>()
  const cohortList: Cohort[] = []
  const cohortOf = (program: string, year: number | null, size: number) => {
    const key = `${program}|${year ?? '-'}`
    let i = cohortIndex.get(key)
    if (i === undefined) {
      i = cohortList.length
      const c = { key, program, year, size }
      cohortList.push(c); cohorts.set(key, c); cohortIndex.set(key, i)
    }
    return i
  }

  // Unscaled reach per lecture, from the program links
  const raw: { probs: Map<number, number>; lecture: OptLecture }[] = []
  for (const lecture of lectures) {
    const tw = typeWeight(lecture.lectureType, p)
    if (tw <= 0) continue
    const probs = new Map<number, number>()
    for (const link of lecture.links) {
      const degree = degreeOf(link)
      if (!degree) continue
      // Programs are per university: LMU's and TUM's "Physik" are different students
      const program = `${lecture.university} ${shortProgramName(link.programName)}`
      const years = degree === 'teaching' || degree === 'minor' ? 1 : p.years[degree] ?? 1
      const size = p.cohortSize[degree] * (p.cohortScale[lecture.university] ?? 1)
      const obligation = (link.obligation && link.obligation in p.attendance ? link.obligation : 'unknown') as keyof Attendance
      let base = p.attendance[obligation] * tw
      let targetYears: number[]
      if (link.semester && years > 1) {
        const inCycle = (link.semester % 2 === 1) === p.winter
        if (!inCycle) base *= p.offCycleFactor
        targetYears = [Math.min(years, Math.ceil(link.semester / 2))]
      } else {
        targetYears = Array.from({ length: years }, (_, i) => i + 1)
      }
      for (const y of targetYears) {
        const i = cohortOf(program, years > 1 ? y : null, size)
        probs.set(i, Math.max(probs.get(i) ?? 0, base))
      }
    }
    // A registered lecture without program links reaches its own group of students
    const known = lecture.registered && lecture.registered > 0 ? lecture.registered * p.registeredShowUp
      : lecture.roomSeats && lecture.roomSeats > 0 ? lecture.roomSeats * p.roomFill : 0
    if (probs.size === 0 && known > 0) {
      if (lecture.pool) probs.set(cohortOf(lecture.pool.key, null, lecture.pool.size), known / lecture.pool.size)
      else probs.set(cohortOf(`(${lecture.id})`, null, known), 1)
    }
    if (probs.size === 0) continue
    raw.push({ probs, lecture })
  }

  // Calibrate to the registration counts: scale each lecture to its target audience and
  // enlarge cohorts that are too small for the reach it implies (a few rounds converge)
  const MAX_P = 0.9
  const target = (r: (typeof raw)[number], weight: number) => {
    const reg = r.lecture.registered
    if (reg && reg > 0) return reg * p.registeredShowUp
    const seats = r.lecture.roomSeats
    if (seats && seats > 0) return seats * p.roomFill
    return Math.min(weight, p.unknownAudienceCap)
  }
  for (let round = 0; round < 4; round++) {
    let grown = false
    for (const r of raw) {
      let weight = 0
      for (const [i, pr] of r.probs) weight += cohortList[i].size * pr
      if (weight <= 0) continue
      const scale = target(r, weight) / weight
      for (const [i, pr] of r.probs) {
        const needed = pr * scale
        if (needed > MAX_P) { cohortList[i].size *= needed / MAX_P; grown = true }
      }
    }
    if (!grown) break
  }

  const reach: { idx: Int32Array; prob: Float64Array; lecture: OptLecture; weight: number }[] = []
  for (const r of raw) {
    let weight = 0
    for (const [i, pr] of r.probs) weight += cohortList[i].size * pr
    if (weight <= 0) continue
    const scale = target(r, weight) / weight
    const idx = Int32Array.from(r.probs.keys())
    const prob = Float64Array.from([...r.probs.values()].map(pr => Math.min(0.95, pr * scale)))
    let w = 0
    for (let k = 0; k < idx.length; k++) w += cohortList[idx[k]].size * prob[k]
    reach.push({ idx, prob, lecture: r.lecture, weight: w })
  }
  return { cohorts: cohortList, reach }
}

export type AudienceEstimate = {
  /** Expected students in one session */
  attendees: number
  basis: 'registrations' | 'room' | 'programs' | 'none'
  /** Short explanation for the UI, e.g. "2,286 registered in TUMonline" */
  detail: string
}

/**
 * Expected students in one session of each lecture, with what the number is based on:
 * registered students * registeredShowUp (TUMonline), else room seats * roomFill (Vorlesungen
 * only), else the program-based model estimate (at most unknownAudienceCap), else nothing.
 */
export function estimateAudiences(lectures: OptLecture[], params: Partial<OptimizeParams> = {}): Map<string, AudienceEstimate> {
  const p = { ...DEFAULT_PARAMS, ...params }
  const fmt = (n: number) => n.toLocaleString('en-US')
  const modelled = new Map(buildModel(lectures, p).reach.map(r => [r.lecture.id, r.weight]))
  const result = new Map<string, AudienceEstimate>()
  for (const l of lectures) {
    const isLecture = typeWeight(l.lectureType, p) > 0
    if (l.registered && l.registered > 0) {
      result.set(l.id, { attendees: Math.round(l.registered * p.registeredShowUp), basis: 'registrations', detail: `${fmt(l.registered)} registered in TUMonline` })
    } else if (isLecture && l.roomSeats && l.roomSeats > 0) {
      result.set(l.id, { attendees: Math.round(l.roomSeats * p.roomFill), basis: 'room', detail: `Room with ${fmt(l.roomSeats)} seats` })
    } else if (modelled.has(l.id)) {
      result.set(l.id, { attendees: Math.round(modelled.get(l.id)!), basis: 'programs', detail: 'Estimate from study programs' })
    } else {
      result.set(l.id, { attendees: 0, basis: 'none', detail: 'No registration, room or program data' })
    }
  }
  return result
}

export function optimize(lectures: OptLecture[], params: Partial<OptimizeParams> = {}): OptimizeResult {
  const p = { ...DEFAULT_PARAMS, ...params }
  const { cohorts, reach } = buildModel(lectures, p)
  const size = Float64Array.from(cohorts.map(c => c.size))
  // miss[g] = probability a student of cohort g is not reached by the current selection
  const miss = new Float64Array(cohorts.length).fill(1)

  const gainOf = (r: (typeof reach)[number]) => {
    let g = 0
    for (let k = 0; k < r.idx.length; k++) g += size[r.idx[k]] * miss[r.idx[k]] * r.prob[k]
    return g
  }
  const add = (r: (typeof reach)[number]) => { for (let k = 0; k < r.idx.length; k++) miss[r.idx[k]] *= 1 - r.prob[k] }
  const remove = (r: (typeof reach)[number]) => { for (let k = 0; k < r.idx.length; k++) miss[r.idx[k]] /= 1 - r.prob[k] }
  const total = () => { let t = 0; for (let g = 0; g < size.length; g++) t += size[g] * (1 - miss[g]); return t }

  // 1. Lazy greedy: stale gains are upper bounds of the true gains (submodularity)
  const k = Math.min(p.visits, reach.length)
  const bound = reach.map(r => r.weight)
  const chosen = new Set<number>()
  // Quotas: a pick is allowed only if the remaining slots can still meet every minimum
  const uniOf = (i: number) => reach[i].lecture.university
  const countBy = (set: Iterable<number>) => {
    const c: Record<string, number> = {}
    for (const i of set) c[uniOf(i)] = (c[uniOf(i)] ?? 0) + 1
    return c
  }
  const feasible = (set: Set<number>) => {
    const c = countBy(set)
    const deficit = Object.entries(p.minPerUniversity).reduce((s, [u, m]) => s + Math.max(0, m - (c[u] ?? 0)), 0)
    return deficit <= k - set.size
  }
  const allowed = (i: number) => {
    chosen.add(i)
    const ok = feasible(chosen)
    chosen.delete(i)
    return ok
  }
  for (let step = 0; step < k; step++) {
    const order = [...bound.keys()].filter(i => !chosen.has(i)).sort((a, b) => bound[b] - bound[a])
    let best = -1, bestGain = -1
    for (const i of order) {
      if (bound[i] <= bestGain) break
      if (!allowed(i)) continue
      bound[i] = gainOf(reach[i])
      if (bound[i] > bestGain) { bestGain = bound[i]; best = i }
    }
    if (best < 0) break
    chosen.add(best); add(reach[best])
  }

  // 2. 1-swap local search: replace a pick by an outside lecture while that raises f
  let swaps = 0
  for (let improved = true; improved && swaps < 200;) {
    improved = false
    const current = total()
    let bestDelta = 1e-6, bestOut = -1, bestIn = -1
    for (const out of [...chosen]) {
      remove(reach[out])
      const without = total()
      // Only lectures with a large enough standalone weight can beat the removed one
      chosen.delete(out)
      for (let i = 0; i < reach.length; i++) {
        if (chosen.has(i) || reach[i].weight + without - current <= bestDelta) continue
        if (!allowed(i)) continue
        const delta = without + gainOf(reach[i]) - current
        if (delta > bestDelta) { bestDelta = delta; bestOut = out; bestIn = i }
      }
      chosen.add(out)
      add(reach[out])
    }
    if (bestOut >= 0) {
      remove(reach[bestOut]); chosen.delete(bestOut)
      add(reach[bestIn]); chosen.add(bestIn)
      swaps++; improved = true
    }
  }

  // 3. Upper bound on the optimum: f(S) + the k largest marginal gains with respect to S
  const value = total()
  const gains = reach.map((r, i) => (chosen.has(i) ? 0 : gainOf(r))).sort((a, b) => b - a)
  const upperBound = value + gains.slice(0, k).reduce((s, g) => s + g, 0)

  // Report picks in greedy order of their contribution
  miss.fill(1)
  const remaining = new Set(chosen)
  const picks: Pick[] = []
  while (remaining.size) {
    let best = -1, bestGain = -1
    for (const i of remaining) { const g = gainOf(reach[i]); if (g > bestGain) { bestGain = g; best = i } }
    remaining.delete(best); add(reach[best])
    const r = reach[best]
    const byProgram = new Map<string, { obligation: string; years: Set<string> }>()
    for (const link of r.lecture.links) {
      if (!degreeOf(link)) continue
      const name = shortProgramName(link.programName)
      const e = byProgram.get(name) ?? { obligation: link.obligation ?? 'unknown', years: new Set<string>() }
      if (link.obligation === 'mandatory') e.obligation = 'mandatory'
      if (link.semester) e.years.add(`${link.semester}.`)
      byProgram.set(name, e)
    }
    picks.push({
      lecture: r.lecture,
      gain: bestGain,
      audience: r.weight,
      programs: [...byProgram.entries()].map(([name, e]) => ({ name, obligation: e.obligation, years: [...e.years].join('/') }))
        .sort((a, b) => Number(b.obligation === 'mandatory') - Number(a.obligation === 'mandatory')),
    })
  }

  return {
    picks,
    total: value,
    upperBound,
    candidates: reach.length,
    cohorts: cohorts.length,
    population: size.reduce((s, x) => s + x, 0),
    swaps,
  }
}
