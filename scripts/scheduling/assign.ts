/**
 * Matches members to the target lectures (model and goal: src/lib/scheduling/assign.ts).
 * Read-only: prints the plan, optionally writes a CSV.
 *
 *   npm run -s visits:assign -- [--until=2026-12-03] [--from=YYYY-MM-DD] [--max-per-person=2]
 *       [--max-per-day=1] [--window=30] [--csv=/path/out.csv]
 *
 * --from defaults to the day after tomorrow (notice for the lecturer); --window is how many
 * minutes from the start of the session a member must be free. Only confirmed availability
 * counts. Lectures that already have a planned, confirmed or done visit are left out, and those
 * visits count towards their members' limits.
 * Needs SUPABASE_URL / SUPABASE_SERVICE_KEY (../tum_scraper/.env is loaded automatically).
 */
import '../mail-bridge/load-env'
import '../outreach/env'
import { writeFileSync } from 'node:fs'
import { createAdminClient } from '@/lib/supabase/admin'
import { sessionsInRange } from '@/lib/date-utils'
import { assignVisits, type AssignLecture, type AssignOption } from '@/lib/scheduling/assign'
import { loadMembers } from '@/lib/scheduling/calendar'
import { covers, fromDateKey, toDateKey, toMinutes } from '@/lib/scheduling/time'
import type { LectureSchedule } from '@/types/database'

const arg = (name: string) => process.argv.slice(2).find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const until = arg('until') ?? '2026-12-03'
const defaultFrom = new Date(); defaultFrom.setDate(defaultFrom.getDate() + 2)
const from = arg('from') ?? toDateKey(defaultFrom)
const maxPerPerson = Number(arg('max-per-person') ?? 2)
const maxPerDay = Number(arg('max-per-day') ?? 1)
const windowMinutes = Number(arg('window') ?? 30)
const csvPath = arg('csv')

async function main() {
  const db = createAdminClient()
  const { data: targets, error } = await db.from('target_lectures')
    .select('lecture_id, lecture:lectures(id, title, university:universities(name), lecture_schedules(*))')
  if (error) throw error
  const lectureRows = (targets ?? []).map(t => t.lecture) as unknown as
    { id: string; title: string; university: { name: string } | null; lecture_schedules: LectureSchedule[] }[]
  const ids = lectureRows.map(l => l.id)
  const { data: scores } = await db.from('lecture_scores').select('lecture_id, score').in('lecture_id', ids)
  const audience = new Map((scores ?? []).map(s => [s.lecture_id as string, Number(s.score)]))

  // Existing visits: their lectures are done, their members partly used up
  const { data: existing } = await db.from('visits').select('lecture_id, scheduled_for, assignee_ids, status')
    .in('status', ['planned', 'confirmed', 'done'])
  const alreadyVisited = new Set((existing ?? []).map(v => v.lecture_id as string))
  const used = new Map<string, number>()
  const busyDays = new Set<string>()
  for (const v of existing ?? []) for (const id of (v.assignee_ids as string[]) ?? []) {
    used.set(id, (used.get(id) ?? 0) + 1)
    if (v.scheduled_for) busyDays.add(`${id}|${toDateKey(new Date(v.scheduled_for as string))}`)
  }

  const members = (await loadMembers(db)).filter(m => m.confirmed && m.slots.length > 0)
  const names = new Map(members.map(m => [m.id, m.name]))
  const lectures: AssignLecture[] = []
  const options: AssignOption[] = []
  const sessionCount = new Map<string, number>()
  for (const l of lectureRows) {
    if (alreadyVisited.has(l.id)) continue
    lectures.push({ id: l.id, title: `[${l.university?.name ?? '?'}] ${l.title}`, audience: audience.get(l.id) ?? 0 })
    const sessions = sessionsInRange(l.lecture_schedules, fromDateKey(from), fromDateKey(until))
    sessionCount.set(l.id, sessions.length)
    for (const s of sessions) {
      const start = toMinutes(s.startTime)
      for (const m of members) {
        if ((used.get(m.id) ?? 0) >= maxPerPerson) continue
        if (busyDays.has(`${m.id}|${toDateKey(s.date)}`)) continue
        if (!covers(m.slots, s.date, start, start + windowMinutes)) continue
        options.push({ lectureId: l.id, memberId: m.id, day: toDateKey(s.date), start: s.date, label: s.label, location: s.location })
      }
    }
  }
  // Members already holding visits have less room left
  const result = assignVisits(lectures, options, { maxPerPerson, maxPerDay })
  for (const [id, n] of used) result.load.set(id, (result.load.get(id) ?? 0) + n)

  const title = new Map(lectures.map(l => [l.id, l.title]))
  console.log(`Sessions ${from} to ${until}; ${members.length} members with confirmed availability; ${lectures.length} target lectures without a visit`)
  console.log(`Limits: ${maxPerPerson} visits per member, ${maxPerDay} per day; free for ${windowMinutes} min from the session start\n`)
  console.log(`${result.visits.length} of ${lectures.length} target lectures get a visit:\n`)
  for (const v of result.visits) {
    console.log(`  ${v.label.padEnd(30)} ${(names.get(v.memberId) ?? v.memberId).padEnd(24)} ${title.get(v.lectureId)}`)
  }
  if (result.unvisited.length) {
    console.log('\nNo visit:')
    for (const u of result.unvisited) {
      const people = new Set(options.filter(o => o.lectureId === u.lecture.id).map(o => names.get(o.memberId)))
      console.log(`  ${u.lecture.title}: ${sessionCount.get(u.lecture.id) ?? 0} sessions; ${u.reason}${people.size ? ` (free: ${[...people].join(', ')})` : ''}`)
    }
  }
  console.log('\nVisits per member:')
  for (const m of members) console.log(`  ${m.name.padEnd(24)} ${result.load.get(m.id) ?? 0}`)

  if (csvPath) {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [['lecture_id', 'lecture', 'session', 'start', 'location', 'member_id', 'member'].join(',')]
    for (const v of result.visits) lines.push([v.lectureId, title.get(v.lectureId), v.label, v.start.toISOString(), v.location, v.memberId, names.get(v.memberId)].map(esc).join(','))
    writeFileSync(csvPath, '﻿' + lines.join('\n'))
    console.log(`\nCSV: ${csvPath}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
