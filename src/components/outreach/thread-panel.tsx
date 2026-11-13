'use client'

import { useEffect, useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { SidePanel } from '@/components/ui/side-panel'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import {
  cancelQueuedMessage, getThreadMessages, previewRequestEmail, queueManualReply, setThreadStatus,
  type OutreachThread,
} from '@/app/actions/outreach'
import { cn } from '@/lib/utils'
import type { EmailMessage, OutreachThreadStatus } from '@/types/database'
import { STATUS_CLASS, STATUS_LABEL, formatDateTime } from './status'

const KIND_LABEL: Record<EmailMessage['kind'], string> = {
  request: 'First email',
  followup: 'Reminder',
  ack_yes: 'Thank-you (yes)',
  ack_no: 'Thank-you (no)',
  confirmation: 'Date confirmation',
  manual: 'Reply by hand',
  reply: 'Lecturer reply',
  bounce: 'Bounce',
}

const MANUAL_STATUSES: { status: OutreachThreadStatus; label: string }[] = [
  { status: 'interested', label: 'Mark interested' },
  { status: 'declined', label: 'Mark declined' },
  { status: 'awaiting_reply', label: 'Back to awaiting reply' },
  { status: 'do_not_contact', label: 'Do not contact again' },
  { status: 'cancelled', label: 'Cancel thread' },
]

type Props = {
  thread: OutreachThread
  onClose: () => void
}

export function ThreadPanel({ thread, onClose }: Props) {
  const { toast } = useToast()
  const [messages, setMessages] = useState<EmailMessage[] | null>(null)
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null)
  const [reply, setReply] = useState('')
  const [isPending, startTransition] = useTransition()

  // The panel is keyed by thread, so state starts fresh for each one
  const threadId = thread.id
  useEffect(() => {
    let cancelled = false
    getThreadMessages(threadId).then(m => { if (!cancelled) setMessages(m) }).catch(() => { if (!cancelled) setMessages([]) })
    return () => { cancelled = true }
  }, [threadId])

  const name = [thread.professor?.title, thread.professor?.first_name, thread.professor?.last_name].filter(Boolean).join(' ')
  const run = (action: () => Promise<void>, message: string) => {
    startTransition(async () => {
      try {
        await action()
        toast({ title: message })
        setMessages(await getThreadMessages(thread.id))
      } catch (error) {
        toast({ title: 'Failed', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' })
      }
    })
  }

  return (
    <SidePanel open onClose={onClose} title={name || thread.to_email} width="w-[680px]">
      <div className="space-y-6 p-6 text-sm">
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', STATUS_CLASS[thread.status])}>
              {STATUS_LABEL[thread.status]}
            </span>
            <span className="text-muted-foreground">{thread.to_email}</span>
            {thread.cc_emails.length > 0 && <span className="text-muted-foreground">CC {thread.cc_emails.join(', ')}</span>}
          </div>
          {thread.attention_reason && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">{thread.attention_reason}</p>
          )}
          {thread.ai_summary && <p><span className="text-muted-foreground">AI summary:</span> {thread.ai_summary}</p>}
          <ul className="space-y-1">
            {[...thread.lectures].sort((a, b) => a.position - b.position).map(l => (
              <li key={l.lecture?.id} className="flex items-center gap-2">
                <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium',
                  l.response === 'yes' ? 'bg-emerald-50 text-emerald-700' : l.response === 'no' ? 'bg-zinc-100 text-zinc-600' : 'bg-slate-50 text-slate-500')}>
                  {l.response === 'yes' ? 'Yes' : l.response === 'no' ? 'No' : 'Open'}
                </span>
                {l.lecture?.title}
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-wrap gap-2">
          {MANUAL_STATUSES.filter(s => s.status !== thread.status).map(s => (
            <Button key={s.status} size="sm" variant="outline" disabled={isPending}
              onClick={() => run(() => setThreadStatus(thread.id, s.status), `Thread: ${STATUS_LABEL[s.status]}`)}>
              {s.label}
            </Button>
          ))}
          {thread.status === 'queued' && !preview && (
            <Button size="sm" variant="ghost" disabled={isPending}
              onClick={() => startTransition(async () => setPreview(await previewRequestEmail(thread.id)))}>
              Preview first email
            </Button>
          )}
        </section>

        {preview && (
          <section className="rounded-lg border p-3 space-y-2">
            <div className="text-xs text-muted-foreground">Preview with the current template</div>
            <div className="font-medium">{preview.subject}</div>
            <pre className="whitespace-pre-wrap font-sans">{preview.body}</pre>
          </section>
        )}

        <section className="space-y-3">
          <h3 className="font-medium">Messages</h3>
          {messages === null && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {messages?.length === 0 && <p className="text-muted-foreground">No messages yet.</p>}
          {messages?.map(m => (
            <article key={m.id} className={cn('rounded-lg border p-3 space-y-2', m.direction === 'inbound' && 'bg-blue-50/40')}>
              <header className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{KIND_LABEL[m.kind]}</span>
                <span>{m.status}</span>
                <span>{formatDateTime(m.received_at ?? m.sent_at ?? m.queued_at)}</span>
                {m.direction === 'inbound' && m.from_email && <span>from {m.from_email}</span>}
                {m.status === 'queued' && (
                  <Button size="sm" variant="ghost" className="h-6 px-2" disabled={isPending}
                    onClick={() => run(() => cancelQueuedMessage(m.id), 'Email cancelled')}>
                    Cancel
                  </Button>
                )}
              </header>
              {m.classification && (
                <p className="text-xs">
                  <span className="font-medium">AI: {m.classification.category}</span> ({m.classification.confidence})
                  {m.classification.conditions && <> · Conditions: {m.classification.conditions}</>}
                </p>
              )}
              {m.processing_error && <p className="text-xs text-red-700">{m.processing_error}</p>}
              {m.error && <p className="text-xs text-red-700">{m.error}</p>}
              {m.subject && <div className="font-medium">{m.subject}</div>}
              {m.body
                ? <pre className="whitespace-pre-wrap font-sans text-[13px] max-h-64 overflow-auto">{m.body}</pre>
                : <p className="text-xs text-muted-foreground">Text is filled in from the template when it&apos;s sent.</p>}
            </article>
          ))}
        </section>

        <section className="space-y-2">
          <h3 className="font-medium">Reply by hand</h3>
          <Textarea id="manual-reply" rows={6} value={reply} onChange={e => setReply(e.target.value)}
            placeholder="Guten Tag …" />
          <Button size="sm" disabled={isPending || !reply.trim()}
            onClick={() => run(async () => { await queueManualReply(thread.id, reply); setReply('') }, 'Reply queued')}>
            Queue reply
          </Button>
          <p className="text-xs text-muted-foreground">Goes out with the next run of the mail bridge, as an answer in the lecturer&apos;s thread.</p>
        </section>
      </div>
    </SidePanel>
  )
}
