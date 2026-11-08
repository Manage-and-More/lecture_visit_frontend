'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { OutreachOverview, OutreachThread } from '@/app/actions/outreach'
import { cn } from '@/lib/utils'
import type { MailSettings, OutreachThreadStatus } from '@/types/database'
import { MailControls } from './mail-controls'
import { TargetFinder } from './target-finder'
import { TemplateEditor } from './template-editor'
import { ThreadPanel } from './thread-panel'
import { STATUS_CLASS, STATUS_LABEL, STATUS_ORDER, formatDateTime } from './status'

type Props = {
  overview: OutreachOverview
  settings: MailSettings
}

export function OutreachDashboard({ overview, settings }: Props) {
  const [statusFilter, setStatusFilter] = useState<OutreachThreadStatus | 'all'>('all')
  const [openId, setOpenId] = useState<string | null>(null)

  const counts = useMemo(() => {
    const c = new Map<OutreachThreadStatus, number>()
    overview.threads.forEach(t => c.set(t.status, (c.get(t.status) ?? 0) + 1))
    return c
  }, [overview.threads])

  const threads = useMemo(() => {
    const list = statusFilter === 'all' ? overview.threads : overview.threads.filter(t => t.status === statusFilter)
    return [...list].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
  }, [overview.threads, statusFilter])

  const open: OutreachThread | null = overview.threads.find(t => t.id === openId) ?? null

  return (
    <div className="space-y-6">
      <MailControls settings={settings} sentLastDay={overview.sentLastDay} queuedCount={overview.queuedCount} bridgeHealthy={overview.bridgeHealthy} unreadReplies={overview.unreadReplies} aiReading={overview.aiReading} />

      <Card>
        <CardHeader>
          <CardTitle>Lecturers ({overview.threads.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setStatusFilter('all')}
              className={cn('rounded-full border px-3 py-1 text-xs', statusFilter === 'all' && 'border-foreground bg-black/[0.04] font-medium')}>
              All {overview.threads.length}
            </button>
            {STATUS_ORDER.filter(s => counts.get(s)).map(s => (
              <button key={s} type="button" onClick={() => setStatusFilter(s)}
                className={cn('rounded-full border px-3 py-1 text-xs', statusFilter === s && 'border-foreground bg-black/[0.04] font-medium')}>
                {STATUS_LABEL[s]} {counts.get(s)}
              </button>
            ))}
          </div>

          {threads.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No lecturers yet. Use &quot;Find lecturers to email&quot; below to queue the first emails.
            </p>
          ) : (
            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lecturer</TableHead>
                    <TableHead>Lectures</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Summary</TableHead>
                    <TableHead className="whitespace-nowrap">Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {threads.map(t => (
                    <TableRow key={t.id} className="cursor-pointer" onClick={() => setOpenId(t.id)}>
                      <TableCell className="align-top">
                        <div className="font-medium">
                          {[t.professor?.title, t.professor?.first_name, t.professor?.last_name].filter(Boolean).join(' ')}
                        </div>
                        <div className="text-xs text-muted-foreground">{t.to_email}</div>
                      </TableCell>
                      <TableCell className="align-top text-sm max-w-[260px]">
                        {t.lectures.map(l => l.lecture?.title).filter(Boolean).join(', ')}
                      </TableCell>
                      <TableCell className="align-top">
                        <span className={cn('whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium', STATUS_CLASS[t.status])}>
                          {STATUS_LABEL[t.status]}
                        </span>
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground max-w-[320px]">
                        {t.attention_reason ?? t.ai_summary ?? ''}
                      </TableCell>
                      <TableCell className="align-top text-xs text-muted-foreground whitespace-nowrap">
                        {formatDateTime(t.updated_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <TargetFinder />
      <TemplateEditor settings={settings} />
      {open && <ThreadPanel key={open.id} thread={open} onClose={() => setOpenId(null)} />}
    </div>
  )
}
