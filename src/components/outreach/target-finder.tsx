'use client'

import { useMemo, useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { previewTargets, queueOutreach } from '@/app/actions/outreach'
import type { TargetResult } from '@/lib/outreach/targets'

export function TargetFinder() {
  const { toast } = useToast()
  const [result, setResult] = useState<TargetResult | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [onlyMatching, setOnlyMatching] = useState(true)
  const [isLoading, startLoading] = useTransition()
  const [isQueueing, startQueueing] = useTransition()

  const load = (matching = onlyMatching) => {
    startLoading(async () => {
      try {
        const next = await previewTargets(matching)
        setResult(next)
        setSelected(new Set(next.candidates.map(c => c.professorId)))
      } catch (error) {
        toast({ title: 'Could not find lecturers', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' })
      }
    })
  }

  const visible = useMemo(() => {
    if (!result) return []
    const q = filter.trim().toLowerCase()
    if (!q) return result.candidates
    return result.candidates.filter(c =>
      c.name.toLowerCase().includes(q) || c.lectures.some(l => l.title.toLowerCase().includes(q)))
  }, [result, filter])

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const queue = () => {
    startQueueing(async () => {
      try {
        const { queued } = await queueOutreach([...selected], onlyMatching)
        toast({ title: `${queued} emails queued`, description: 'They go out with the next check-ins, within the daily limit.' })
        setResult(null)
        setSelected(new Set())
      } catch (error) {
        toast({ title: 'Nothing queued', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' })
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add lecturers</CardTitle>
        <CardDescription>
          Finds mandatory lectures of starred study programs, plus starred lectures, that still have sessions left and a lecturer
          with a known email. Each lecturer gets one email covering all their lectures.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyMatching}
            disabled={isLoading || isQueueing}
            onChange={e => {
              setOnlyMatching(e.target.checked)
              if (result) load(e.target.checked)
            }}
          />
          Only lectures that fit the team&apos;s availability (a session where at least one member is free)
        </label>

        {!result && (
          <Button onClick={() => load()} disabled={isLoading} variant="outline">
            {isLoading && <Loader2 className="animate-spin" />}
            {isLoading ? 'Finding lecturers…' : 'Find lecturers to email'}
          </Button>
        )}

        {result && (
          <>
            {result.onlyMatching && result.membersWithAvailability === 0 && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Nobody on the team has entered availability yet, so no lecture fits. Ask the team to fill in &quot;My availability&quot;.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium">{result.candidates.length} lecturers found</span>
              {result.skipped.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  Skipped: {result.skipped.map(s => `${s.reason} (${s.count})`).join(' · ')}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="target-filter"
                placeholder="Filter by name or lecture"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                className="max-w-xs"
              />
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(result.candidates.map(c => c.professorId)))}>Select all</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Select none</Button>
            </div>

            <div className="max-h-[420px] overflow-auto rounded-lg border divide-y">
              {visible.map(c => (
                <label key={c.professorId} className="flex gap-3 p-3 text-sm cursor-pointer hover:bg-black/[0.02]">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.has(c.professorId)}
                    onChange={() => toggle(c.professorId)}
                  />
                  <div className="min-w-0 space-y-1">
                    <div className="font-medium">
                      {c.name} <span className="font-normal text-muted-foreground">· {c.email}</span>
                    </div>
                    <ul className="text-muted-foreground space-y-0.5">
                      {c.lectures.map(l => (
                        <li key={l.id}>
                          {l.title}
                          {l.match
                            ? <span className="text-xs text-emerald-700"> — fits: {l.match.label} ({l.match.members.join(', ')}){l.matchingSessions > 1 ? `, ${l.matchingSessions - 1} more` : ''}</span>
                            : l.nextSession && <span className="text-xs"> — next: {l.nextSession}</span>}
                        </li>
                      ))}
                    </ul>
                    {c.cc.length > 0 && <div className="text-xs text-muted-foreground">CC: {c.cc.map(x => x.email).join(', ')}</div>}
                    {c.warnings.length > 0 && <div className="text-xs text-amber-700">{c.warnings.join(' · ')}</div>}
                  </div>
                </label>
              ))}
              {visible.length === 0 && <div className="p-3 text-sm text-muted-foreground">No lecturers match.</div>}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={queue} disabled={isQueueing || selected.size === 0}>
                {isQueueing && <Loader2 className="animate-spin" />}
                Queue {selected.size} emails
              </Button>
              <Button variant="outline" onClick={() => setResult(null)} disabled={isQueueing}>Close</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
