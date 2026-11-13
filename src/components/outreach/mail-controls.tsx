'use client'

import { useState, useTransition } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { updateMailSettings } from '@/app/actions/outreach'
import { cn } from '@/lib/utils'
import type { MailMode, MailSettings } from '@/types/database'
import { formatDateTime } from './status'

const MODES: { value: MailMode; label: string; description: string }[] = [
  { value: 'off', label: 'Off', description: 'Nothing is sent. Queued emails wait.' },
  { value: 'test', label: 'Test', description: 'Every email goes to your own address, marked [TEST].' },
  { value: 'live', label: 'Live', description: 'Emails go to lecturers.' },
]

type Props = {
  settings: MailSettings
  sentLastDay: number
  queuedCount: number
  bridgeHealthy: boolean
  unreadReplies: number
  aiReading: boolean
}

export function MailControls({ settings, sentLastDay, queuedCount, bridgeHealthy, unreadReplies, aiReading }: Props) {
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [confirmLive, setConfirmLive] = useState(false)
  const [dailyCap, setDailyCap] = useState(String(settings.daily_cap))
  const [followupDays, setFollowupDays] = useState(String(settings.followup_after_days))
  const [maxFollowups, setMaxFollowups] = useState(String(settings.max_followups))

  const save = (changes: Partial<MailSettings>, message: string) => {
    startTransition(async () => {
      try {
        await updateMailSettings(changes)
        toast({ title: message })
      } catch (error) {
        toast({ title: 'Not saved', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' })
      }
    })
  }

  const chooseMode = (mode: MailMode) => {
    if (mode === settings.mode) return
    if (mode === 'live' && !confirmLive) {
      setConfirmLive(true)
      return
    }
    setConfirmLive(false)
    save({ mode }, `Sending is now ${MODES.find(m => m.value === mode)!.label.toLowerCase()}`)
  }

  const bridgeSeen = !!settings.last_bridge_at

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sending</CardTitle>
        <CardDescription>
          Emails go out from {settings.sender_email} through the TUM mail bridge on the organiser&apos;s Mac. Each run sends up to {settings.per_run_cap} queued emails and picks up new replies.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Sending mode">
          {MODES.map(mode => (
            <button
              key={mode.value}
              type="button"
              role="radio"
              aria-checked={settings.mode === mode.value}
              disabled={isPending}
              onClick={() => chooseMode(mode.value)}
              className={cn(
                'flex-1 min-w-[160px] rounded-lg border px-3 py-2 text-left transition-colors',
                settings.mode === mode.value ? 'border-foreground bg-black/[0.03]' : 'hover:bg-black/[0.02]',
              )}
            >
              <div className="text-sm font-medium">{mode.label}</div>
              <div className="text-xs text-muted-foreground">{mode.description}</div>
            </button>
          ))}
        </div>

        {confirmLive && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm space-y-2">
            <p>
              Live mode emails real lecturers from {settings.sender_email}. {queuedCount} emails are queued,
              and up to {settings.daily_cap} go out per 24 hours.
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => chooseMode('live')} disabled={isPending}>Switch to live</Button>
              <Button size="sm" variant="outline" onClick={() => setConfirmLive(false)}>Keep current mode</Button>
            </div>
          </div>
        )}

        <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div className="rounded-lg bg-black/[0.03] p-3">
            <dt className="text-muted-foreground text-xs">Sent in last 24 h</dt>
            <dd className="text-lg font-semibold tabular-nums">{sentLastDay} / {settings.daily_cap}</dd>
          </div>
          <div className="rounded-lg bg-black/[0.03] p-3">
            <dt className="text-muted-foreground text-xs">Queued</dt>
            <dd className="text-lg font-semibold tabular-nums">{queuedCount}</dd>
          </div>
          <div className="rounded-lg bg-black/[0.03] p-3 col-span-2">
            <dt className="text-muted-foreground text-xs">Mail bridge (TUM)</dt>
            <dd className="font-medium">
              {bridgeSeen
                ? <span className={bridgeHealthy ? 'text-emerald-700' : 'text-amber-700'}>
                    Last run {formatDateTime(settings.last_bridge_at)}{bridgeHealthy ? '' : ' (more than 15 minutes ago)'}
                  </span>
                : <span className="text-amber-700">Hasn&apos;t checked in yet</span>}
            </dd>
          </div>
        </dl>

        {unreadReplies > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {unreadReplies} {unreadReplies === 1 ? 'reply is' : 'replies are'} waiting to be read.{' '}
            {aiReading
              ? 'The AI reads them with the next run of the mail bridge.'
              : <>Say &quot;process the outreach inbox&quot; in Claude Code, or open the threads marked &quot;Needs attention&quot; and decide by hand.</>}
          </div>
        )}

        {settings.last_bridge_error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 whitespace-pre-wrap">
            {settings.last_bridge_error}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 items-end">
          <div className="space-y-1">
            <Label htmlFor="daily-cap">Emails per 24 h</Label>
            <Input id="daily-cap" type="number" min={0} max={1000} value={dailyCap} onChange={e => setDailyCap(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="followup-days">Reminder after (days)</Label>
            <Input id="followup-days" type="number" min={1} max={60} value={followupDays} onChange={e => setFollowupDays(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="max-followups">Reminders per lecturer</Label>
            <Input id="max-followups" type="number" min={0} max={3} value={maxFollowups} onChange={e => setMaxFollowups(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => save({
              daily_cap: Number(dailyCap),
              followup_after_days: Number(followupDays),
              max_followups: Number(maxFollowups),
            }, 'Limits saved')}
          >
            Save limits
          </Button>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.auto_ack_yes}
              disabled={isPending}
              onChange={e => save({ auto_ack_yes: e.target.checked }, 'Saved')}
            />
            Thank lecturers who say yes automatically
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.auto_ack_no}
              disabled={isPending}
              onChange={e => save({ auto_ack_no: e.target.checked }, 'Saved')}
            />
            Thank lecturers who say no automatically
          </label>
        </div>
      </CardContent>
    </Card>
  )
}
