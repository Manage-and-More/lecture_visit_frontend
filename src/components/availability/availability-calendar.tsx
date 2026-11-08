'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Repeat } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SidePanel } from '@/components/ui/side-panel'
import { useToast } from '@/hooks/use-toast'
import {
  deleteAvailabilityEntry, saveAvailabilityEntry, type AvailabilityEntry,
} from '@/app/actions/visit-planning'
import {
  fromDateKey, fromMinutes, isoWeekday, mondayOf, occursOn, toDateKey, toMinutes, type Slot,
} from '@/lib/scheduling/time'
import { cn } from '@/lib/utils'

const DAY_START = 7 * 60
const DAY_END = 21 * 60
const SNAP = 15
const PX_PER_MINUTE = 0.9
const DAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

type Draft = Omit<AvailabilityEntry, 'id'> & { id?: string }

function defaultWeekKey(): string {
  const today = new Date()
  const monday = mondayOf(today)
  if (isoWeekday(today) === 7) monday.setDate(monday.getDate() + 7)
  return toDateKey(monday)
}

function toSlot(e: AvailabilityEntry): Slot {
  return { date: e.date, start: toMinutes(e.start), end: toMinutes(e.end), repeatsWeekly: e.repeatsWeekly, repeatUntil: e.repeatUntil }
}

function formatDay(key: string): string {
  return fromDateKey(key).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function AvailabilityCalendar({ entries }: { entries: AvailabilityEntry[] }) {
  const router = useRouter()
  const { toast } = useToast()
  const [weekKey, setWeekKey] = useState(defaultWeekKey)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [selecting, setSelecting] = useState<{ day: number; from: number; to: number } | null>(null)
  const [isPending, startTransition] = useTransition()
  const columnRefs = useRef<(HTMLDivElement | null)[]>([])

  const weekStart = fromDateKey(weekKey)
  const days = useMemo(() => DAY_LABELS.map((label, i) => {
    const date = fromDateKey(weekKey)
    date.setDate(date.getDate() + i)
    return { label, date, key: toDateKey(date) }
  }), [weekKey])

  const shiftWeek = (weeks: number) => {
    const d = fromDateKey(weekKey)
    d.setDate(d.getDate() + weeks * 7)
    setWeekKey(toDateKey(d))
  }

  const minuteAt = (dayIndex: number, clientY: number) => {
    const rect = columnRefs.current[dayIndex]?.getBoundingClientRect()
    if (!rect) return DAY_START
    const raw = DAY_START + (clientY - rect.top) / PX_PER_MINUTE
    return Math.min(DAY_END, Math.max(DAY_START, Math.round(raw / SNAP) * SNAP))
  }

  const finishSelection = () => {
    if (!selecting) return
    const start = Math.min(selecting.from, selecting.to)
    let end = Math.max(selecting.from, selecting.to)
    if (end - start < 30) end = Math.min(DAY_END, start + 60) // a click books an hour
    setDraft({
      date: days[selecting.day].key,
      start: fromMinutes(start),
      end: fromMinutes(end),
      repeatsWeekly: false,
      repeatUntil: null,
    })
    setSelecting(null)
  }

  const save = () => {
    if (!draft) return
    startTransition(async () => {
      try {
        await saveAvailabilityEntry(draft)
        toast({ title: draft.id ? 'Availability updated' : 'Availability added' })
        setDraft(null)
        router.refresh()
      } catch (error) {
        toast({ title: 'Not saved', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' })
      }
    })
  }

  const remove = () => {
    if (!draft?.id) return
    const id = draft.id
    startTransition(async () => {
      try {
        await deleteAvailabilityEntry(id)
        toast({ title: 'Availability removed' })
        setDraft(null)
        router.refresh()
      } catch (error) {
        toast({ title: 'Not removed', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' })
      }
    })
  }

  const height = (DAY_END - DAY_START) * PX_PER_MINUTE
  const hours: number[] = []
  for (let m = DAY_START; m < DAY_END; m += 60) hours.push(m)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)

  return (
    <div className="rounded-lg border bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => shiftWeek(-1)} aria-label="Previous week"><ChevronLeft /></Button>
        <Button size="sm" variant="outline" onClick={() => setWeekKey(defaultWeekKey())}>This week</Button>
        <Button size="sm" variant="outline" onClick={() => shiftWeek(1)} aria-label="Next week"><ChevronRight /></Button>
        <span className="text-sm font-medium tabular-nums">
          {weekStart.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} – {weekEnd.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}
        </span>
        <span className="text-sm text-muted-foreground ml-auto">Drag over a day to add a time you&apos;re free. Click an entry to change it.</span>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[760px] select-none">
          <div className="grid grid-cols-[48px_repeat(7,1fr)] border-b text-xs font-medium">
            <div />
            {days.map(d => (
              <div key={d.key} className="px-2 py-1.5 border-l">
                {d.label} {d.date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-[48px_repeat(7,1fr)]">
            <div className="relative" style={{ height }}>
              {hours.map(m => (
                <div key={m} className="absolute right-1 text-[10px] text-muted-foreground -translate-y-1/2" style={{ top: (m - DAY_START) * PX_PER_MINUTE }}>
                  {m > DAY_START ? fromMinutes(m) : ''}
                </div>
              ))}
            </div>
            {days.map((d, dayIndex) => {
              const occurrences = entries.filter(e => occursOn(toSlot(e), d.date))
              return (
                <div
                  key={d.key}
                  ref={el => { columnRefs.current[dayIndex] = el }}
                  className="relative border-l cursor-crosshair touch-none"
                  style={{ height }}
                  onPointerDown={e => {
                    if ((e.target as HTMLElement).closest('[data-entry]')) return
                    e.currentTarget.setPointerCapture(e.pointerId)
                    const m = minuteAt(dayIndex, e.clientY)
                    setSelecting({ day: dayIndex, from: m, to: m })
                  }}
                  onPointerMove={e => {
                    if (selecting?.day === dayIndex) setSelecting({ ...selecting, to: minuteAt(dayIndex, e.clientY) })
                  }}
                  onPointerUp={finishSelection}
                >
                  {hours.map(m => (
                    <div key={m} className="absolute inset-x-0 border-t border-black/[0.06]" style={{ top: (m - DAY_START) * PX_PER_MINUTE }} />
                  ))}
                  {occurrences.map(e => {
                    const start = Math.max(DAY_START, toMinutes(e.start))
                    const end = Math.min(DAY_END, toMinutes(e.end))
                    if (end <= start) return null
                    return (
                      <button
                        key={e.id}
                        type="button"
                        data-entry
                        onClick={() => setDraft({ ...e })}
                        className="absolute inset-x-1 z-10 overflow-hidden rounded-md bg-emerald-500 px-1.5 py-0.5 text-left text-[11px] leading-tight text-white shadow-sm hover:bg-emerald-600"
                        style={{ top: (start - DAY_START) * PX_PER_MINUTE, height: Math.max(16, (end - start) * PX_PER_MINUTE - 2) }}
                      >
                        <div className="flex items-center gap-1 font-medium">
                          {e.repeatsWeekly && <Repeat className="h-3 w-3 shrink-0" aria-label="Repeats every week" />}
                          {e.start}–{e.end}
                        </div>
                      </button>
                    )
                  })}
                  {selecting?.day === dayIndex && (
                    <div
                      className="absolute inset-x-1 z-20 rounded-md border-2 border-emerald-600 bg-emerald-100/70"
                      style={{
                        top: (Math.min(selecting.from, selecting.to) - DAY_START) * PX_PER_MINUTE,
                        height: Math.max(8, Math.abs(selecting.to - selecting.from) * PX_PER_MINUTE),
                      }}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {draft && (
        <SidePanel open onClose={() => setDraft(null)} title={draft.id ? 'Change availability' : 'Add availability'} width="w-[420px]">
          <div className="space-y-4 p-6 text-sm">
            <div className="space-y-1">
              <Label htmlFor="avail-date">{draft.repeatsWeekly ? 'First day' : 'Day'}</Label>
              <Input id="avail-date" type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} />
              {draft.date && <p className="text-xs text-muted-foreground">{formatDay(draft.date)}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="avail-start">From</Label>
                <Input id="avail-start" type="time" step={900} value={draft.start} onChange={e => setDraft({ ...draft, start: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="avail-end">Until</Label>
                <Input id="avail-end" type="time" step={900} value={draft.end} onChange={e => setDraft({ ...draft, end: e.target.value })} />
              </div>
            </div>
            <label className="flex items-center gap-2">
              <input
                id="avail-repeat"
                type="checkbox"
                checked={draft.repeatsWeekly}
                onChange={e => setDraft({ ...draft, repeatsWeekly: e.target.checked, repeatUntil: e.target.checked ? draft.repeatUntil : null })}
              />
              Repeat every week
              {draft.date && draft.repeatsWeekly && (
                <span className="text-muted-foreground">(every {fromDateKey(draft.date).toLocaleDateString('en-GB', { weekday: 'long' })})</span>
              )}
            </label>
            {draft.repeatsWeekly && (
              <div className="space-y-1">
                <Label htmlFor="avail-until">Last day (optional)</Label>
                <Input id="avail-until" type="date" min={draft.date} value={draft.repeatUntil ?? ''}
                  onChange={e => setDraft({ ...draft, repeatUntil: e.target.value || null })} />
                <p className="text-xs text-muted-foreground">Leave empty to repeat for the rest of the semester.</p>
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-2">
              <Button onClick={save} disabled={isPending}>{draft.id ? 'Save changes' : 'Add'}</Button>
              {draft.id && (
                <Button variant="outline" onClick={remove} disabled={isPending}>
                  {draft.repeatsWeekly ? 'Delete (every week)' : 'Delete'}
                </Button>
              )}
              <Button variant="ghost" onClick={() => setDraft(null)} disabled={isPending}>Cancel</Button>
            </div>
          </div>
        </SidePanel>
      )}

      <p className={cn('text-xs text-muted-foreground')}>
        Visits are only planned in times you marked here, and only when you&apos;re free for at least 30 minutes from the start of a lecture.
      </p>
    </div>
  )
}
