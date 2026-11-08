'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import {
  acceptVisit, discardVisit, getCalendarWeek, getProposedVisits, proposeVisitsAction,
  type ProposedVisit,
} from '@/app/actions/visit-planning'
import type { CalendarScope, CalendarWeek } from '@/lib/scheduling/calendar'
import type { ProposalResult } from '@/lib/scheduling/auto'
import { fromDateKey, isoWeekday, mondayOf, toDateKey } from '@/lib/scheduling/time'
import { WeekGrid } from './week-grid'
import { DetailPanel, type Selection } from './detail-panel'

const SCOPES: { value: CalendarScope; label: string }[] = [
  { value: 'targets', label: 'Target lectures (starred)' },
  { value: 'outreach', label: 'Lectures in outreach' },
  { value: 'search', label: 'Search by title' },
]

/** This week's Monday; on Sundays the coming week, since the current one is over. */
function defaultWeekKey(): string {
  const today = new Date()
  const monday = mondayOf(today)
  if (isoWeekday(today) === 7) monday.setDate(monday.getDate() + 7)
  return toDateKey(monday)
}

function formatStart(iso: string) {
  return new Date(iso).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function VisitCalendar() {
  const { toast } = useToast()
  const [weekKey, setWeekKey] = useState(defaultWeekKey)
  const [scope, setScope] = useState<CalendarScope>('targets')
  const [university, setUniversity] = useState('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [week, setWeek] = useState<CalendarWeek | null>(null)
  const [proposals, setProposals] = useState<ProposedVisit[]>([])
  const [selection, setSelection] = useState<Selection | null>(null)
  const [weeksAhead, setWeeksAhead] = useState(3)
  const [lastRun, setLastRun] = useState<ProposalResult | null>(null)
  const [isLoading, startLoading] = useTransition()
  const [isProposing, startProposing] = useTransition()

  const reload = useCallback(() => {
    startLoading(async () => {
      try {
        const [nextWeek, nextProposals] = await Promise.all([
          getCalendarWeek({ weekStart: weekKey, scope, university, search }),
          getProposedVisits(),
        ])
        setWeek(nextWeek)
        setProposals(nextProposals)
      } catch (error) {
        toast({ title: 'Could not load the calendar', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' })
      }
    })
  }, [weekKey, scope, university, search, toast])

  useEffect(() => { reload() }, [reload])

  const memberNames = useMemo(() => new Map((week?.members ?? []).map(m => [m.id, m.name])), [week])
  const membersWithAvailability = (week?.members ?? []).filter(m => m.slots.length > 0).length

  const shiftWeek = (weeks: number) => {
    const d = fromDateKey(weekKey)
    d.setDate(d.getDate() + weeks * 7)
    setWeekKey(toDateKey(d))
  }

  const propose = () => {
    startProposing(async () => {
      try {
        const result = await proposeVisitsAction(weeksAhead)
        setLastRun(result)
        toast({ title: `${result.proposed} visits proposed`, description: result.unscheduled.length ? `${result.unscheduled.length} lectures couldn't be scheduled` : undefined })
        reload()
      } catch (error) {
        toast({ title: 'Scheduling failed', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' })
      }
    })
  }

  const actOnProposal = (action: () => Promise<unknown>, message: string) => {
    startProposing(async () => {
      try {
        await action()
        toast({ title: message })
        reload()
      } catch (error) {
        toast({ title: 'Failed', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' })
      }
    })
  }

  const weekStart = fromDateKey(weekKey)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 5)

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Automatic scheduling</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            For every lecture whose lecturer said yes, picks the earliest session in the coming weeks where two members
            (or at least one) are free, spreading visits evenly. {membersWithAvailability} {membersWithAvailability === 1 ? 'member has' : 'members have'} entered availability.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="weeks-ahead" className="text-sm">Look ahead</label>
            <select id="weeks-ahead" value={weeksAhead} onChange={e => setWeeksAhead(Number(e.target.value))}
              className="h-9 rounded-md border bg-white px-2 text-sm">
              {[1, 2, 3, 4, 6].map(n => <option key={n} value={n}>{n} {n === 1 ? 'week' : 'weeks'}</option>)}
            </select>
            <Button onClick={propose} disabled={isProposing}>
              {isProposing && <Loader2 className="animate-spin" />}
              Propose visits
            </Button>
          </div>
          {lastRun && lastRun.unscheduled.length > 0 && (
            <ul className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 space-y-0.5">
              {lastRun.unscheduled.map((u, i) => <li key={i}>{u.title}: {u.reason}</li>)}
            </ul>
          )}

          {proposals.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-medium">{proposals.length} proposed {proposals.length === 1 ? 'visit' : 'visits'} to review</h3>
              <div className="rounded-lg border divide-y">
                {proposals.map(p => (
                  <div key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{formatStart(p.start)} · {p.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.lecturer && `${p.lecturer} · `}{p.location ?? 'no room'} · Team: {p.team.join(', ') || 'nobody'}
                      </div>
                      {p.notes && <div className="text-xs text-amber-800">{p.notes}</div>}
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setWeekKey(toDateKey(mondayOf(new Date(p.start))))}>Show</Button>
                    <Button size="sm" disabled={isProposing}
                      onClick={() => actOnProposal(() => acceptVisit(p.id), 'Accepted. The date confirmation goes out with the next check-in.')}>
                      Accept
                    </Button>
                    <Button size="sm" variant="outline" disabled={isProposing}
                      onClick={() => actOnProposal(() => discardVisit(p.id), 'Proposal removed')}>
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Accepting emails the lecturer the date (text: &quot;Date confirmation&quot; on the outreach page).</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => shiftWeek(-1)} aria-label="Previous week"><ChevronLeft /></Button>
        <Button size="sm" variant="outline" onClick={() => setWeekKey(defaultWeekKey())}>This week</Button>
        <Button size="sm" variant="outline" onClick={() => shiftWeek(1)} aria-label="Next week"><ChevronRight /></Button>
        <span className="text-sm font-medium tabular-nums">
          {weekStart.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} – {weekEnd.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}
        </span>
        <div className="flex-1" />
        <select aria-label="Which lectures" value={scope} onChange={e => setScope(e.target.value as CalendarScope)}
          className="h-9 rounded-md border bg-white px-2 text-sm">
          {SCOPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select aria-label="University" value={university} onChange={e => setUniversity(e.target.value)}
          className="h-9 rounded-md border bg-white px-2 text-sm">
          <option value="all">LMU and TUM</option>
          <option value="TUM">TUM</option>
          <option value="LMU">LMU</option>
        </select>
        {scope === 'search' && (
          <form onSubmit={e => { e.preventDefault(); setSearch(searchInput) }} className="flex gap-2">
            <Input id="calendar-search" placeholder="Lecture title" value={searchInput} onChange={e => setSearchInput(e.target.value)} className="h-9 w-56" />
            <Button size="sm" type="submit" variant="outline">Search</Button>
          </form>
        )}
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {week && (
        <>
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span>{week.sessions.length} sessions this week, only lectures with a known lecturer email{week.truncated ? ' (first 600 lectures only: narrow the filter)' : ''}</span>
            <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-emerald-500/30" /> members free</span>
            <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm border-2 border-dashed border-violet-600" /> proposed visit</span>
            <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-violet-600" /> accepted visit</span>
          </div>
          {scope === 'outreach' && week.sessions.length === 0 && !isLoading && (
            <p className="text-sm text-muted-foreground">No lectures in outreach yet. Switch to &quot;Target lectures&quot; or search to see other lectures.</p>
          )}
          <WeekGrid
            weekStart={weekStart}
            sessions={week.sessions}
            visits={week.visits}
            members={week.members}
            memberNames={memberNames}
            onSelectSession={s => setSelection({ kind: 'session', session: s })}
            onSelectVisit={v => setSelection({ kind: 'visit', visit: v })}
          />
        </>
      )}

      {selection && week && (
        <DetailPanel
          key={selection.kind === 'session' ? selection.session.key : selection.visit.id}
          selection={selection}
          members={week.members}
          visits={week.visits}
          onClose={() => setSelection(null)}
          onChanged={reload}
        />
      )}
    </div>
  )
}
