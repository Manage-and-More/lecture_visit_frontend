import type { LectureSchedule } from '@/types/database'

export type ExtrapolatedDate = {
  date: Date
  label: string // e.g. "Di. 31.03.2026, 14:00 - 16:00"
  weekDay: string // e.g. "Dienstag"
  dateStr: string // e.g. "31.03.2026"
  startTime: string // e.g. "14:00"
  endTime: string // e.g. "16:00"
  location?: string | null
}

export const DAY_MAP: Record<string, number> = {
  'Mo': 1, 'Di': 2, 'Mi': 3, 'Do': 4, 'Fr': 5, 'Sa': 6, 'So': 0,
}

export const DAY_FULL_NAME: Record<string, string> = {
  'Mo': 'Montag', 'Di': 'Dienstag', 'Mi': 'Mittwoch', 'Do': 'Donnerstag',
  'Fr': 'Freitag', 'Sa': 'Samstag', 'So': 'Sonntag',
}

// Abbreviated (LMU: "Di.") and full (TUM: "Dienstag") German weekday names
const DAY_ALIASES: Record<string, string> = {
  mo: 'Mo', montag: 'Mo',
  di: 'Di', dienstag: 'Di',
  mi: 'Mi', mittwoch: 'Mi',
  do: 'Do', donnerstag: 'Do',
  fr: 'Fr', freitag: 'Fr',
  sa: 'Sa', samstag: 'Sa',
  so: 'So', sonntag: 'So',
}

function shiftTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + minutes
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

const ABBR_BY_DAY_INDEX = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

/**
 * Parses the weekdays and time of a schedule slot. Accepted formats:
 * - LMU: "Di. 14:00 bis 16:00", "Fr. 10:00 bis 12:00 c.t.", "-. 09:00 bis 18:00 s.t." (no weekday)
 * - TUM: "Dienstag, 10:30 - 12:00", "Dienstag ,Mittwoch  undDonnerstag, 09:00 - 17:00"
 * "c.t." (cum tempore) means the lecture starts 15 minutes late and ends 15 minutes early.
 * `days` is empty when the slot names no weekday; such a slot only yields dates for single-day ranges.
 */
export function parseDayTime(dayTime: string): { days: string[]; startTime: string; endTime: string } | null {
  const match = dayTime.trim().match(/^(.*?)\s*(\d{1,2}:\d{2})\s*(?:bis|-|–)\s*(\d{1,2}:\d{2})(.*)$/i)
  if (!match) return null
  const tokens = match[1].replace(/und/gi, ' ').split(/[^A-Za-z]+/).filter(Boolean)
  const days = tokens.map(t => DAY_ALIASES[t.toLowerCase()])
  if (days.some(d => !d)) return null
  let startTime = match[2].padStart(5, '0')
  let endTime = match[3].padStart(5, '0')
  if (/c\.\s*t\./i.test(match[4])) {
    startTime = shiftTime(startTime, 15)
    endTime = shiftTime(endTime, -15)
  }
  return { days: [...new Set(days)], startTime, endTime }
}

const DATE = String.raw`(\d{1,2})\.(\d{1,2})\.(\d{4})`
const RANGE_RE = new RegExp(`${DATE}\\s*(?:bis|-|–)\\s*${DATE}`)
const SINGLE_RE = new RegExp(DATE)

/**
 * Parses the dates a schedule slot covers. Accepted formats:
 * - ranges: "14.10.2026 - 03.02.2027", "14.10.2026 bis 03.02.2027", "von 14.10.2026 bis 03.02.2027"
 * - single dates: "am 13.01.2027" (start and end are the same day)
 */
export function parseDateRange(dateRange: string): { start: Date; end: Date } | null {
  const range = dateRange.match(RANGE_RE)
  if (range) {
    return {
      start: new Date(+range[3], +range[2] - 1, +range[1]),
      end: new Date(+range[6], +range[5] - 1, +range[4]),
    }
  }
  const single = dateRange.match(SINGLE_RE)
  if (single) {
    const day = new Date(+single[3], +single[2] - 1, +single[1])
    return { start: day, end: new Date(day) }
  }
  return null
}

/** Weeks between sessions: 2 for LMU "14-tägl." (biweekly), otherwise 1. */
export function parseIntervalWeeks(frequency: string | null): number {
  if (frequency && /14\s*-?\s*t(ä|ae)gl|zweiwöch|biweekly/i.test(frequency)) return 2
  return 1
}

export const WEEKS_PER_PAGE = 2

export function extrapolateDates(schedules: LectureSchedule[], weeksOffset: number, weeks: number = WEEKS_PER_PAGE): ExtrapolatedDate[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const pageStart = new Date(today)
  pageStart.setDate(pageStart.getDate() + weeksOffset * 7)
  const pageEnd = new Date(pageStart)
  pageEnd.setDate(pageEnd.getDate() + weeks * 7)

  const results: ExtrapolatedDate[] = []

  for (const schedule of schedules) {
    if (!schedule.day_time) continue
    const parsed = parseDayTime(schedule.day_time)
    if (!parsed) continue

    const range = schedule.date_range ? parseDateRange(schedule.date_range) : null
    const windowStart = new Date(Math.max(pageStart.getTime(), today.getTime(), range?.start.getTime() ?? 0))
    const windowEnd = new Date(Math.min(pageEnd.getTime(), range?.end.getTime() ?? pageEnd.getTime()))

    if (windowStart > windowEnd) continue

    const push = (day: Date) => {
      const dd = String(day.getDate()).padStart(2, '0')
      const mm = String(day.getMonth() + 1).padStart(2, '0')
      const yyyy = day.getFullYear()
      const dateStr = `${dd}.${mm}.${yyyy}`
      const [h, m] = parsed.startTime.split(':').map(Number)
      const date = new Date(day)
      date.setHours(h, m, 0, 0)
      const dayAbbr = ABBR_BY_DAY_INDEX[day.getDay()]
      results.push({
        date,
        label: `${dayAbbr}. ${dateStr}, ${parsed.startTime} - ${parsed.endTime}`,
        weekDay: DAY_FULL_NAME[dayAbbr],
        dateStr,
        startTime: parsed.startTime,
        endTime: parsed.endTime,
        location: schedule.location,
      })
    }

    // A single session ("am 13.01.2027") is that date, whatever the weekday says
    if (range && range.start.getTime() === range.end.getTime()) {
      push(range.start)
      continue
    }

    // Biweekly sessions count from the first session of the range, not from today
    const stepDays = parseIntervalWeeks(schedule.frequency) * 7
    for (const abbr of parsed.days) {
      const cursor = new Date(stepDays > 7 && range ? range.start : windowStart)
      cursor.setDate(cursor.getDate() + ((DAY_MAP[abbr] - cursor.getDay() + 7) % 7))
      while (cursor < windowStart) cursor.setDate(cursor.getDate() + stepDays)

      while (cursor <= windowEnd) {
        push(cursor)
        cursor.setDate(cursor.getDate() + stepDays)
      }
    }
  }

  results.sort((a, b) => a.date.getTime() - b.date.getTime())
  return results
}

export function hasMoreDates(schedules: LectureSchedule[], weeksOffset: number): boolean {
  return extrapolateDates(schedules, weeksOffset + WEEKS_PER_PAGE).length > 0
}
