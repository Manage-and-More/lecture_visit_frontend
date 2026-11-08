'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { saveMyAvailability, type AvailabilitySlot } from '@/app/actions/visit-planning'
import { fromMinutes, toMinutes } from '@/lib/scheduling/time'
import { cn } from '@/lib/utils'

const DAYS = [
  { weekday: 1, label: 'Mo' }, { weekday: 2, label: 'Di' }, { weekday: 3, label: 'Mi' },
  { weekday: 4, label: 'Do' }, { weekday: 5, label: 'Fr' }, { weekday: 6, label: 'Sa' },
]
const START = 8 * 60
const END = 21 * 60
const STEP = 30
const ROWS = (END - START) / STEP

const cellKey = (weekday: number, row: number) => `${weekday}:${row}`

function slotsToCells(slots: AvailabilitySlot[]): Set<string> {
  const cells = new Set<string>()
  for (const s of slots) {
    for (let m = toMinutes(s.start); m < toMinutes(s.end); m += STEP) {
      const row = (m - START) / STEP
      if (row >= 0 && row < ROWS) cells.add(cellKey(s.weekday, row))
    }
  }
  return cells
}

function cellsToSlots(cells: Set<string>): AvailabilitySlot[] {
  const slots: AvailabilitySlot[] = []
  for (const day of DAYS) {
    let runStart: number | null = null
    for (let row = 0; row <= ROWS; row++) {
      const on = row < ROWS && cells.has(cellKey(day.weekday, row))
      if (on && runStart === null) runStart = row
      if (!on && runStart !== null) {
        slots.push({ weekday: day.weekday, start: fromMinutes(START + runStart * STEP), end: fromMinutes(START + row * STEP) })
        runStart = null
      }
    }
  }
  return slots
}

export function AvailabilityEditor({ initialSlots }: { initialSlots: AvailabilitySlot[] }) {
  const { toast } = useToast()
  const [cells, setCells] = useState(() => slotsToCells(initialSlots))
  const [dirty, setDirty] = useState(false)
  const [isPending, startTransition] = useTransition()
  const paint = useRef<boolean | null>(null)

  useEffect(() => {
    const stop = () => { paint.current = null }
    window.addEventListener('pointerup', stop)
    return () => window.removeEventListener('pointerup', stop)
  }, [])

  const apply = (key: string, value: boolean) => {
    setCells(prev => {
      if (prev.has(key) === value) return prev
      const next = new Set(prev)
      if (value) next.add(key)
      else next.delete(key)
      return next
    })
    setDirty(true)
  }

  const save = () => {
    startTransition(async () => {
      try {
        await saveMyAvailability(cellsToSlots(cells))
        setDirty(false)
        toast({ title: 'Availability saved' })
      } catch (error) {
        toast({ title: 'Not saved', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' })
      }
    })
  }

  const hours = cells.size * STEP / 60

  return (
    <div className="rounded-lg border bg-white p-4 space-y-3">
      <p className="text-sm text-muted-foreground">
        Click or drag over the grid to mark when you&apos;re free, every week of the semester. Click marked cells to remove them.
      </p>
      <div className="overflow-x-auto">
        <div className="grid min-w-[560px] grid-cols-[48px_repeat(6,1fr)] select-none touch-none text-xs">
          <div />
          {DAYS.map(d => <div key={d.weekday} className="pb-1 text-center font-medium">{d.label}</div>)}
          {Array.from({ length: ROWS }, (_, row) => (
            <div key={row} className="contents">
              <div className="pr-2 text-right text-[10px] text-muted-foreground leading-5">
                {row % 2 === 0 ? fromMinutes(START + row * STEP) : ''}
              </div>
              {DAYS.map(d => {
                const key = cellKey(d.weekday, row)
                const on = cells.has(key)
                return (
                  <div
                    key={key}
                    role="checkbox"
                    aria-checked={on}
                    aria-label={`${d.label} ${fromMinutes(START + row * STEP)}`}
                    onPointerDown={e => { e.preventDefault(); paint.current = !on; apply(key, !on) }}
                    onPointerEnter={() => { if (paint.current !== null) apply(key, paint.current) }}
                    className={cn('h-5 border-l border-t border-black/[0.06] cursor-pointer', on ? 'bg-emerald-500' : 'hover:bg-emerald-100', row % 2 === 0 && 'border-t-black/[0.12]')}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={isPending || !dirty}>{dirty ? 'Save availability' : 'Saved'}</Button>
        <span className="text-sm text-muted-foreground">{hours} hours per week marked</span>
      </div>
    </div>
  )
}
