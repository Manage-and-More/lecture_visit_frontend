'use client'

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { CalendarMember, CalendarSession, CalendarVisit } from '@/lib/scheduling/calendar'
import { covers, fromMinutes } from '@/lib/scheduling/time'
import { STATUS_CLASS, STATUS_LABEL } from '@/components/outreach/status'

export const DAY_START = 7 * 60
export const DAY_END = 21 * 60
const PX_PER_MINUTE = 1
const DAYS = [
  { weekday: 1, label: 'Mo' }, { weekday: 2, label: 'Di' }, { weekday: 3, label: 'Mi' },
  { weekday: 4, label: 'Do' }, { weekday: 5, label: 'Fr' }, { weekday: 6, label: 'Sa' },
]

type Item =
  | { kind: 'session'; key: string; start: number; end: number; session: CalendarSession }
  | { kind: 'visit'; key: string; start: number; end: number; visit: CalendarVisit }

type Placed = Item & { lane: number; lanes: number }

/** Side-by-side lanes for overlapping items, like a calendar app. */
function layout(items: Item[]): Placed[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end)
  const placed: Placed[] = []
  let group: Placed[] = []
  let groupEnd = -1
  const flush = () => {
    const lanes = Math.max(1, ...group.map(p => p.lane + 1))
    group.forEach(p => { p.lanes = lanes })
    group = []
  }
  for (const item of sorted) {
    if (item.start >= groupEnd) { flush(); groupEnd = -1 }
    const laneEnds: number[] = []
    group.forEach(p => { laneEnds[p.lane] = Math.max(laneEnds[p.lane] ?? 0, p.end) })
    let lane = laneEnds.findIndex(end => end <= item.start)
    if (lane === -1) lane = laneEnds.length
    const p: Placed = { ...item, lane, lanes: 1 }
    group.push(p)
    placed.push(p)
    groupEnd = Math.max(groupEnd, item.end)
  }
  flush()
  return placed
}

type Props = {
  weekStart: Date
  sessions: CalendarSession[]
  visits: CalendarVisit[]
  members: CalendarMember[]
  memberNames: Map<string, string>
  onSelectSession: (s: CalendarSession) => void
  onSelectVisit: (v: CalendarVisit) => void
}

export function WeekGrid({ weekStart, sessions, visits, members, memberNames, onSelectSession, onSelectVisit }: Props) {
  const byDay = useMemo(() => {
    const clamp = (m: number) => Math.min(DAY_END, Math.max(DAY_START, m))
    return DAYS.map(day => {
      const items: Item[] = [
        ...sessions.filter(s => s.weekday === day.weekday).map(s => ({
          kind: 'session' as const, key: s.key, start: clamp(s.startMinutes), end: clamp(Math.max(s.endMinutes, s.startMinutes + 30)), session: s,
        })),
        ...visits.filter(v => v.weekday === day.weekday).map(v => ({
          kind: 'visit' as const, key: v.id, start: clamp(v.startMinutes), end: clamp(v.startMinutes + Math.max(v.durationMinutes, 30)), visit: v,
        })),
      ].filter(i => i.end > i.start)
      return { ...day, placed: layout(items) }
    })
  }, [sessions, visits])

  // How many members are free in each half hour, as background shading
  const freeCounts = useMemo(() => DAYS.map(day => {
    const counts: number[] = []
    for (let m = DAY_START; m < DAY_END; m += 30) {
      counts.push(members.filter(mem => covers(mem.slots, day.weekday, m, m + 30)).length)
    }
    return counts
  }), [members])
  const maxFree = Math.max(1, ...freeCounts.flat())

  const height = (DAY_END - DAY_START) * PX_PER_MINUTE
  const hours = []
  for (let m = DAY_START; m < DAY_END; m += 60) hours.push(m)

  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <div className="min-w-[900px]">
        <div className="grid grid-cols-[48px_repeat(6,1fr)] border-b text-xs font-medium">
          <div />
          {DAYS.map((day, i) => {
            const date = new Date(weekStart)
            date.setDate(date.getDate() + i)
            return (
              <div key={day.weekday} className="px-2 py-2 border-l">
                {day.label} {date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
              </div>
            )
          })}
        </div>
        <div className="grid grid-cols-[48px_repeat(6,1fr)]">
          <div className="relative" style={{ height }}>
            {hours.map(m => (
              <div key={m} className="absolute right-1 text-[10px] text-muted-foreground -translate-y-1/2"
                style={{ top: (m - DAY_START) * PX_PER_MINUTE }}>
                {m > DAY_START ? fromMinutes(m) : ''}
              </div>
            ))}
          </div>
          {byDay.map((day, dayIndex) => (
            <div key={day.weekday} className="relative border-l" style={{ height }}>
              {freeCounts[dayIndex].map((count, i) => count > 0 && (
                <div key={i} className="absolute inset-x-0 bg-emerald-500"
                  title={`${count} ${count === 1 ? 'member' : 'members'} free`}
                  style={{ top: i * 30 * PX_PER_MINUTE, height: 30 * PX_PER_MINUTE, opacity: 0.04 + 0.14 * (count / maxFree) }} />
              ))}
              {hours.map(m => (
                <div key={m} className="absolute inset-x-0 border-t border-black/[0.05]" style={{ top: (m - DAY_START) * PX_PER_MINUTE }} />
              ))}
              {day.placed.map(p => {
                const style = {
                  top: (p.start - DAY_START) * PX_PER_MINUTE,
                  height: Math.max(18, (p.end - p.start) * PX_PER_MINUTE - 2),
                  left: `calc(${(p.lane / p.lanes) * 100}% + 2px)`,
                  width: `calc(${100 / p.lanes}% - 4px)`,
                }
                if (p.kind === 'visit') {
                  const v = p.visit
                  return (
                    <button key={p.key} type="button" onClick={() => onSelectVisit(v)} style={style}
                      className={cn('absolute z-20 overflow-hidden rounded-md border-2 border-violet-600 px-1.5 py-0.5 text-left text-[11px] leading-tight shadow-sm',
                        v.status === 'planned' ? 'border-dashed bg-violet-50 text-violet-900' : 'bg-violet-600 text-white')}>
                      <div className="font-semibold truncate">{v.status === 'planned' ? 'Proposed: ' : 'Visit: '}{v.title}</div>
                      <div className="truncate">{fromMinutes(v.startMinutes)} · {v.assigneeIds.map(id => memberNames.get(id) ?? 'Member').join(', ') || 'nobody yet'}</div>
                    </button>
                  )
                }
                const s = p.session
                const tone = s.outreachStatus ? STATUS_CLASS[s.outreachStatus] : 'bg-white text-slate-700'
                return (
                  <button key={p.key} type="button" onClick={() => onSelectSession(s)} style={style}
                    title={`${s.title} (${fromMinutes(s.startMinutes)}–${fromMinutes(s.endMinutes)})`}
                    className={cn('absolute z-10 overflow-hidden rounded-md border border-black/10 px-1.5 py-0.5 text-left text-[11px] leading-tight hover:ring-2 hover:ring-black/20', tone)}>
                    <div className="font-medium truncate">{s.title}</div>
                    <div className="truncate opacity-80">
                      {fromMinutes(s.startMinutes)}–{fromMinutes(s.endMinutes)} · {s.university}
                      {s.outreachStatus ? ` · ${STATUS_LABEL[s.outreachStatus]}` : ''}
                    </div>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
