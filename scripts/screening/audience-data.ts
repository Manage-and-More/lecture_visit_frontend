/**
 * Collected audience data that lives outside the repo (see ../lecture_visit_data/<semester>/README.md):
 *  - TUM registrations per lecture ({lecture_id: registered students}, from TUMonline)
 *  - LMU room seats per room ({location as in lecture_schedules: seats}, from deincampusplan.de)
 *  - the LMU lecture list with faculties (lmu_scraper data/<semester>/lecture_sections.csv)
 * Each file is optional; lectures without data fall back to the program-based estimate.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { OptLecture } from '@/lib/screening/optimize'

/** "WiSe 2026/27" -> "wise_2026_27" */
export const semesterSlug = (semester: string) => semester.toLowerCase().replace(/[^a-z0-9]+/g, '_')

export function defaultDataPaths(semester: string) {
  const slug = semesterSlug(semester)
  const data = resolve(process.cwd(), '../lecture_visit_data', slug)
  return {
    registrations: resolve(data, 'tum-registrations.json'),
    rooms: resolve(data, 'lmu-room-seats.json'),
    sections: resolve(process.cwd(), '../lmu_scraper/data', slug, 'lecture_sections.csv'),
  }
}

/**
 * LMU students per faculty, from the official subject-group totals of WiSe 2024/25
 * (Bayerisches Landesamt für Statistik, B3110C 202422, table 3.1), split evenly over the
 * faculties of each group. Psychology and education count as social sciences, informatics
 * as engineering, as in the official classification.
 */
export const LMU_FACULTY_POOL: Record<string, number> = (() => {
  const groups: [number, string[]][] = [
    [12968, ['Katholisch-Theologische Fakultät', 'Evangelisch-Theologische Fakultät', 'Fakultät für Philosophie, Wissenschaftstheorie und Religionswissenschaft',
      'Fakultät für Geschichts- und Kunstwissenschaften', 'Fakultät für Sprach- und Literaturwissenschaften', 'Fakultät für Kulturwissenschaften']],
    [16721, ['Juristische Fakultät', 'Fakultät für Betriebswirtschaft', 'Volkswirtschaftliche Fakultät', 'Sozialwissenschaftliche Fakultät', 'Fakultät für Psychologie und Pädagogik']],
    [10018, ['Fakultät für Mathematik, Informatik und Statistik', 'Fakultät für Physik', 'Fakultät für Chemie und Pharmazie', 'Fakultät für Biologie', 'Fakultät für Geowissenschaften']],
    [7203, ['Medizinische Fakultät']],
    [1876, ['Tierärztliche Fakultät']],
  ]
  const pool: Record<string, number> = {}
  for (const [total, faculties] of groups) for (const f of faculties) pool[f] = total / faculties.length
  pool['Fakultät für Mathematik, Informatik und Statistik'] += 3544 // engineering group = informatics
  pool['Fakultät für Geschichts- und Kunstwissenschaften'] += 1279 // arts group
  return pool
})()

function readFaculties(path: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of readFileSync(path, 'utf8').split('\n').slice(1)) {
    const m = line.match(/^(\d+),(?:"(?:[^"]|"")*"|[^,]*),("(?:[^"]|"")*"|[^,]*),/)
    if (m) map.set(String(Number(m[1])), m[2].replace(/^"|"$/g, '').replace(/""/g, '"'))
  }
  return map
}

export type DataLecture = OptLecture & { locations: string[]; externalId: string | null }

/** Adds registrations, room seats and LMU faculty pools to the lectures; logs what it found. */
export function attachAudienceData(lectures: DataLecture[], paths: { registrations?: string; rooms?: string; sections?: string }) {
  const available = (path: string | undefined, label: string) => {
    if (!path) return false
    if (existsSync(path)) return true
    console.warn(`No ${label} file at ${path}; skipped`)
    return false
  }
  if (available(paths.registrations, 'registrations')) {
    const reg = JSON.parse(readFileSync(paths.registrations!, 'utf8')) as Record<string, number>
    let known = 0
    for (const l of lectures) { const n = reg[l.id]; if (typeof n === 'number') { l.registered = n; known++ } }
    console.log(`Registration counts for ${known} of ${lectures.length} lectures`)
  }
  if (available(paths.sections, 'LMU lecture sections')) {
    const faculties = readFaculties(paths.sections!)
    let known = 0
    for (const l of lectures) {
      if (l.university !== 'LMU' || !l.externalId) continue
      const faculty = faculties.get(String(Number(l.externalId)))
      const size = faculty ? LMU_FACULTY_POOL[faculty] : undefined
      if (faculty && size) { l.pool = { key: `LMU ${faculty}`, size }; known++ }
    }
    console.log(`Faculty for ${known} LMU lectures`)
  }
  if (available(paths.rooms, 'room seats')) {
    const seats = JSON.parse(readFileSync(paths.rooms!, 'utf8')) as Record<string, unknown>
    let known = 0
    for (const l of lectures) {
      const sizes = l.locations.map(loc => seats[loc]).filter((n): n is number => typeof n === 'number' && n > 0)
      if (sizes.length) { l.roomSeats = Math.max(...sizes); known++ }
    }
    console.log(`Room size for ${known} of ${lectures.length} lectures`)
  }
}
