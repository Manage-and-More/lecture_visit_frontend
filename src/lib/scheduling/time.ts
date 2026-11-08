/** Minutes since midnight for "HH:MM" or "HH:MM:SS". */
export function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

export function fromMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: Date): number {
  return date.getDay() === 0 ? 7 : date.getDay()
}

/** Monday of the week containing `date`, at local midnight. */
export function mondayOf(date: Date): Date {
  const monday = new Date(date)
  monday.setHours(0, 0, 0, 0)
  monday.setDate(monday.getDate() - (isoWeekday(monday) - 1))
  return monday
}

export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export type Slot = { weekday: number; start: number; end: number } // minutes

/** True if the slots cover the whole interval [start, end) on that weekday. */
export function covers(slots: Slot[], weekday: number, start: number, end: number): boolean {
  return slots.some(s => s.weekday === weekday && s.start <= start && s.end >= end)
}
