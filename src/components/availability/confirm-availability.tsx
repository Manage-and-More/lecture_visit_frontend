'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { confirmMyAvailability } from '@/app/actions/visit-planning'

/** Commit step: only confirmed availability is used to match lectures and plan visits. */
export function ConfirmAvailability({ confirmedAt, hasEntries }: { confirmedAt: string | null; hasEntries: boolean }) {
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()

  const confirm = () => {
    startTransition(async () => {
      try {
        await confirmMyAvailability()
        toast({ title: 'Availability confirmed', description: 'It now counts for matching lectures and planning visits.' })
        router.refresh()
      } catch (error) {
        toast({ title: 'Not confirmed', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' })
      }
    })
  }

  if (confirmedAt) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <CheckCircle2 className="h-5 w-5 shrink-0" />
        <span>
          Confirmed on {new Date(confirmedAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })}.
          Visits are planned in these times. If you change anything, confirm again.
        </span>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <span className="flex-1 min-w-[240px]">
        {hasEntries
          ? 'Your availability isn\'t confirmed yet, so it doesn\'t count for planning. Check your times, then confirm them.'
          : 'Add the times you can visit lectures, then confirm them. Only confirmed availability is used for planning.'}
      </span>
      <Button onClick={confirm} disabled={isPending || !hasEntries}>Confirm my availability</Button>
    </div>
  )
}
