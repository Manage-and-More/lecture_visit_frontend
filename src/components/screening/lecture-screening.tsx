'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import {
  getScreeningPage, setLectureRelevant, type ScreeningFilters, type ScreeningPage,
} from '@/app/actions/screening'
import { cn } from '@/lib/utils'

const MAX_CHIPS = 5

export function LectureScreening({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast()
  const [filters, setFilters] = useState<ScreeningFilters>({
    search: '', university: 'all', onlyVorlesung: true, onlyWithEmail: true, onlyRelevant: false, page: 0,
  })
  const [searchInput, setSearchInput] = useState('')
  const [data, setData] = useState<ScreeningPage | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [isLoading, startLoading] = useTransition()
  const [isSaving, startSaving] = useTransition()

  const load = useCallback(() => {
    startLoading(async () => {
      try {
        setData(await getScreeningPage(filters))
      } catch (error) {
        toast({ title: 'Could not load lectures', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' })
      }
    })
  }, [filters, toast])
  useEffect(() => { load() }, [load])

  const update = (patch: Partial<ScreeningFilters>) => setFilters(f => ({ ...f, ...patch, page: patch.page ?? 0 }))

  const toggle = (id: string, relevant: boolean) => {
    startSaving(async () => {
      try {
        await setLectureRelevant(id, relevant)
        load()
      } catch (error) {
        toast({ title: 'Not saved', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' })
      }
    })
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="space-y-4">
      {data && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border bg-white px-4 py-3 text-sm">
          <span><span className="font-semibold tabular-nums">{data.coverage.relevantLectures}</span> relevant lectures</span>
          <span>reach <span className="font-semibold tabular-nums">{data.coverage.programsReached}</span> programs</span>
          <span className="text-muted-foreground">({data.coverage.mandatoryPrograms} as a mandatory course)</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={e => { e.preventDefault(); update({ search: searchInput }) }} className="flex gap-2">
          <Input id="screening-search" placeholder="Search lecture title" value={searchInput} onChange={e => setSearchInput(e.target.value)} className="h-9 w-64" />
          <Button size="sm" type="submit" variant="outline">Search</Button>
        </form>
        <select aria-label="University" value={filters.university} onChange={e => update({ university: e.target.value as ScreeningFilters['university'] })}
          className="h-9 rounded-md border bg-white px-2 text-sm">
          <option value="all">LMU and TUM</option>
          <option value="TUM">TUM</option>
          <option value="LMU">LMU</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={filters.onlyVorlesung} onChange={e => update({ onlyVorlesung: e.target.checked })} /> Vorlesungen only
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={filters.onlyWithEmail} onChange={e => update({ onlyWithEmail: e.target.checked })} /> Lecturer email known
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={filters.onlyRelevant} onChange={e => update({ onlyRelevant: e.target.checked })} /> Relevant only
        </label>
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {data && !data.scored && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          The lectures of {data.semester} haven&apos;t been scored yet.
        </p>
      )}

      {data && (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-20 px-3 py-2 font-medium">Relevant</th>
                <th className="px-3 py-2 font-medium">Lecture</th>
                <th className="w-28 px-3 py-2 font-medium">Est. audience</th>
                <th className="px-3 py-2 font-medium">Programs</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.rows.map(row => {
                const open = expanded.has(row.id)
                const chips = open ? row.programs : row.programs.slice(0, MAX_CHIPS)
                return (
                  <tr key={row.id} className={cn('align-top', row.relevant && 'bg-emerald-50/40')}>
                    <td className="px-3 py-3">
                      <input type="checkbox" aria-label={`Relevant: ${row.title}`} checked={row.relevant} disabled={!canEdit || isSaving}
                        onChange={e => toggle(row.id, e.target.checked)} className="h-4 w-4" />
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium">{row.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.university}{row.lectureType ? ` · ${row.lectureType}` : ''}{row.nextSession ? ` · next: ${row.nextSession}` : ''}
                        {!row.hasEmail && ' · no lecturer email'}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-semibold tabular-nums" title={row.reasons.join('\n')}>{row.score.toFixed(1)}</div>
                      <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{row.reasons[0]}</div>
                    </td>
                    <td className="px-3 py-3">
                      {row.programs.length === 0 ? <span className="text-xs text-muted-foreground">No program information</span> : (
                        <div className="flex flex-wrap gap-1">
                          {chips.map(p => (
                            <span key={p.name}
                              title={`${p.mandatory ? 'Mandatory' : 'Not mandatory'}${p.semester ? `, ${p.semester}. semester` : ''}${p.reached ? ', already reached by a relevant lecture' : ''}`}
                              className={cn('rounded px-1.5 py-0.5 text-[11px]',
                                p.reached ? 'bg-zinc-100 text-zinc-500' : p.mandatory ? 'bg-emerald-100 text-emerald-900 font-medium' : 'bg-slate-100 text-slate-700')}>
                              {p.name}{p.semester ? ` · ${p.semester}.` : ''}
                            </span>
                          ))}
                          {row.programs.length > MAX_CHIPS && (
                            <button type="button" className="text-[11px] text-muted-foreground underline"
                              onClick={() => setExpanded(prev => { const n = new Set(prev); if (n.has(row.id)) n.delete(row.id); else n.add(row.id); return n })}>
                              {open ? 'less' : `+${row.programs.length - MAX_CHIPS} more`}
                            </button>
                          )}
                        </div>
                      )}
                      {!row.relevant && row.newPrograms > 0 && data.coverage.relevantLectures > 0 && (
                        <div className="mt-1 text-[11px] text-emerald-700">Adds {row.newPrograms} program{row.newPrograms === 1 ? '' : 's'} not reached yet</div>
                      )}
                    </td>
                  </tr>
                )
              })}
              {data.rows.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No lectures match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <div className="flex items-center gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={filters.page === 0 || isLoading} onClick={() => update({ page: filters.page - 1 })} aria-label="Previous page"><ChevronLeft /></Button>
          <span className="tabular-nums">Page {filters.page + 1} of {pages} · {data.total} lectures</span>
          <Button size="sm" variant="outline" disabled={filters.page + 1 >= pages || isLoading} onClick={() => update({ page: filters.page + 1 })} aria-label="Next page"><ChevronRight /></Button>
          <span className="ml-auto text-xs text-muted-foreground">
            Green: mandatory in that program · grey: already reached by a relevant lecture · number: recommended semester
          </span>
        </div>
      )}
    </div>
  )
}
