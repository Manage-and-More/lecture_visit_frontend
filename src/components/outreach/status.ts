import type { OutreachThreadStatus } from '@/types/database'

export const STATUS_LABEL: Record<OutreachThreadStatus, string> = {
  queued: 'Queued',
  awaiting_reply: 'Awaiting reply',
  interested: 'Interested',
  declined: 'Declined',
  needs_attention: 'Needs attention',
  scheduled: 'Scheduled',
  do_not_contact: 'Do not contact',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

export const STATUS_CLASS: Record<OutreachThreadStatus, string> = {
  queued: 'bg-slate-100 text-slate-700',
  awaiting_reply: 'bg-blue-50 text-blue-700',
  interested: 'bg-emerald-50 text-emerald-700',
  declined: 'bg-zinc-100 text-zinc-600',
  needs_attention: 'bg-amber-50 text-amber-800',
  scheduled: 'bg-emerald-100 text-emerald-800',
  do_not_contact: 'bg-red-50 text-red-700',
  failed: 'bg-red-50 text-red-700',
  cancelled: 'bg-zinc-50 text-zinc-500',
}

export const STATUS_ORDER: OutreachThreadStatus[] = [
  'needs_attention', 'interested', 'awaiting_reply', 'queued', 'scheduled',
  'declined', 'failed', 'do_not_contact', 'cancelled',
]

export function formatDateTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin',
  })
}
