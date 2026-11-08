'use client'

import { useState, useTransition } from 'react'
import { SidePanel } from '@/components/ui/side-panel'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { acceptVisit, createVisit, discardVisit, updateVisitAssignees } from '@/app/actions/visit-planning'
import type { CalendarMember, CalendarSession, CalendarVisit } from '@/lib/scheduling/calendar'
import { covers, fromMinutes } from '@/lib/scheduling/time'
import { cn } from '@/lib/utils'
import { STATUS_CLASS, STATUS_LABEL } from '@/components/outreach/status'

const MIN_GAP_MINUTES = 90

export type Selection =
  | { kind: 'session'; session: CalendarSession }
  | { kind: 'visit'; visit: CalendarVisit }

type Props = {
  selection: Selection
  members: CalendarMember[]
  visits: CalendarVisit[]
  onClose: () => void
  onChanged: () => void
}

/** Members free at that time (availability covers 30 minutes) and not on another visit nearby. */
function freeMembers(members: CalendarMember[], visits: CalendarVisit[], startMinutes: number, startIso: string, ignoreVisitId?: string) {
  const start = new Date(startIso).getTime()
  return members.filter(m =>
    covers(m.slots, new Date(startIso), startMinutes, startMinutes + 30) &&
    !visits.some(v => v.id !== ignoreVisitId && v.assigneeIds.includes(m.id) &&
      Math.abs(new Date(v.start).getTime() - start) < MIN_GAP_MINUTES * 60_000))
}

function MemberPicker({ members, free, selected, onToggle }: {
  members: CalendarMember[]; free: Set<string>; selected: Set<string>; onToggle: (id: string) => void
}) {
  const sorted = [...members].sort((a, b) => Number(free.has(b.id)) - Number(free.has(a.id)))
  if (members.length === 0) return <p className="text-muted-foreground">No members found.</p>
  return (
    <div className="max-h-56 overflow-auto rounded-lg border divide-y">
      {sorted.map(m => (
        <label key={m.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-black/[0.02]">
          <input type="checkbox" checked={selected.has(m.id)} onChange={() => onToggle(m.id)} />
          <span className={cn(!free.has(m.id) && 'text-muted-foreground')}>{m.name}</span>
          <span className="ml-auto text-xs">
            {free.has(m.id) ? <span className="text-emerald-700">free</span>
              : m.slots.length ? <span className="text-muted-foreground">not free</span>
              : <span className="text-muted-foreground">no availability entered</span>}
          </span>
        </label>
      ))}
    </div>
  )
}

export function DetailPanel({ selection, members, visits, onClose, onChanged }: Props) {
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const initial = selection.kind === 'visit' ? selection.visit.assigneeIds : []
  const [selected, setSelected] = useState<Set<string>>(new Set(initial))
  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const run = (action: () => Promise<unknown>, message: string, close = true) => {
    startTransition(async () => {
      try {
        await action()
        toast({ title: message })
        onChanged()
        if (close) onClose()
      } catch (error) {
        toast({ title: 'Failed', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' })
      }
    })
  }

  if (selection.kind === 'session') {
    const s = selection.session
    const free = new Set(freeMembers(members, visits, s.startMinutes, s.start).map(m => m.id))
    return (
      <SidePanel open onClose={onClose} title={s.title} width="w-[560px]">
        <div className="space-y-5 p-6 text-sm">
          <dl className="grid grid-cols-[110px_1fr] gap-y-1.5">
            <dt className="text-muted-foreground">When</dt><dd>{s.dateLabel}, {fromMinutes(s.startMinutes)}–{fromMinutes(s.endMinutes)}</dd>
            <dt className="text-muted-foreground">Where</dt><dd>{s.location ?? '—'}</dd>
            <dt className="text-muted-foreground">Lecturers</dt><dd>{s.lecturers || '—'}</dd>
            <dt className="text-muted-foreground">University</dt><dd>{s.university}{s.lectureType ? ` · ${s.lectureType}` : ''}</dd>
            <dt className="text-muted-foreground">Outreach</dt>
            <dd>
              {s.outreachStatus
                ? <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', STATUS_CLASS[s.outreachStatus])}>{STATUS_LABEL[s.outreachStatus]}</span>
                : 'Not contacted'}
              {s.response && s.response !== 'pending' && <span className="ml-2">Answer for this lecture: {s.response}</span>}
            </dd>
            {s.conditions && (<><dt className="text-muted-foreground">Conditions</dt><dd className="text-amber-800">{s.conditions}</dd></>)}
          </dl>

          <section className="space-y-2">
            <h3 className="font-medium">Plan a visit at the start of this session ({fromMinutes(s.startMinutes)})</h3>
            <p className="text-muted-foreground">{free.size} {free.size === 1 ? 'member is' : 'members are'} free then.</p>
            <MemberPicker members={members} free={free} selected={selected} onToggle={toggle} />
            <Button size="sm" disabled={isPending || selected.size === 0}
              onClick={() => run(() => createVisit({
                lectureId: s.lectureId, outreachId: s.outreachId, start: s.start, location: s.location, assigneeIds: [...selected],
              }), 'Visit proposed. Accept it to email the lecturer.')}>
              Propose visit with {selected.size} {selected.size === 1 ? 'person' : 'people'}
            </Button>
            {!s.outreachId && <p className="text-xs text-muted-foreground">This lecturer hasn&apos;t been contacted, so accepting won&apos;t send a confirmation email.</p>}
          </section>
        </div>
      </SidePanel>
    )
  }

  const v = selection.visit
  const free = new Set(freeMembers(members, visits, v.startMinutes, v.start, v.id).map(m => m.id))
  const start = new Date(v.start)
  return (
    <SidePanel open onClose={onClose} title={`${v.status === 'planned' ? 'Proposed visit' : 'Visit'}: ${v.title}`} width="w-[560px]">
      <div className="space-y-5 p-6 text-sm">
        <dl className="grid grid-cols-[110px_1fr] gap-y-1.5">
          <dt className="text-muted-foreground">When</dt>
          <dd>{start.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' })}, {fromMinutes(v.startMinutes)} ({v.durationMinutes} min)</dd>
          <dt className="text-muted-foreground">Where</dt><dd>{v.location ?? '—'}</dd>
          <dt className="text-muted-foreground">Status</dt><dd>{v.status === 'planned' ? 'Proposed, not confirmed to the lecturer yet' : v.status}</dd>
          {v.notes && (<><dt className="text-muted-foreground">Notes</dt><dd>{v.notes}</dd></>)}
        </dl>

        {v.status === 'planned' && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={isPending}
              onClick={() => run(async () => {
                await updateVisitAssignees(v.id, [...selected])
                const { emailQueued } = await acceptVisit(v.id)
                if (!emailQueued) toast({ title: 'No confirmation email', description: 'This lecture has no outreach thread.' })
              }, 'Visit accepted. The date confirmation goes to the lecturer with the next check-in.')}>
              Accept and email the lecturer
            </Button>
            <Button size="sm" variant="outline" disabled={isPending}
              onClick={() => run(() => discardVisit(v.id), 'Proposal removed')}>
              Remove proposal
            </Button>
          </div>
        )}

        <section className="space-y-2">
          <h3 className="font-medium">Who goes</h3>
          <MemberPicker members={members} free={free} selected={selected} onToggle={toggle} />
          <Button size="sm" variant="outline" disabled={isPending}
            onClick={() => run(() => updateVisitAssignees(v.id, [...selected]), 'Team saved', false)}>
            Save team
          </Button>
        </section>

        {v.status === 'confirmed' && (
          <Button size="sm" variant="outline" disabled={isPending}
            onClick={() => run(() => discardVisit(v.id), 'Visit cancelled. Tell the lecturer in the outreach thread.')}>
            Cancel visit
          </Button>
        )}
      </div>
    </SidePanel>
  )
}
