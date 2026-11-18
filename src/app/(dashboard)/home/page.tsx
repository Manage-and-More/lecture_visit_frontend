import Link from 'next/link'
import { CalendarCheck, CheckCircle2, CircleDashed } from 'lucide-react'
import { getMyVisits, getTeamStatus } from '@/app/actions/visit-planning'
import { cn } from '@/lib/utils'
import { OUTREACH_ENABLED } from '@/lib/features'

// The order is the workflow
const STEPS = [
  { title: 'Screen relevant lectures', href: '/lectures', disabled: false },
  { title: 'Enter your availability', href: '/availability', disabled: false },
  { title: 'Match lectures to free times', href: '/calendar', disabled: false },
  { title: 'Run the outreach', href: '/outreach', disabled: !OUTREACH_ENABLED },
]

const VISIT_DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Berlin' })
const VISIT_TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Berlin' })

/** First page after signing in: your own visits, the workflow in four steps, and who has committed their availability. */
export default async function HomePage() {
  const [team, myVisits] = await Promise.all([getTeamStatus(), getMyVisits()])
  const confirmed = team.filter(t => t.status === 'confirmed').length

  return (
    <div className="animate-fade-in-up mx-auto max-w-3xl space-y-10 pt-10">
      <div className="space-y-2">
        <h1 className="text-balance text-3xl font-semibold tracking-tight">Plan lecture visits</h1>
        <p className="text-muted-foreground">For Manage and More, at TUM and LMU.</p>
      </div>

      {myVisits.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Your lecture visits</h2>
          <ul className="space-y-2">
            {myVisits.map(v => (
              <li key={v.id} className="flex gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm">
                <CalendarCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
                <div className="min-w-0 space-y-0.5">
                  <div className="font-medium">{v.title}</div>
                  <div>
                    {VISIT_DAY.format(new Date(v.start))}, lecture starts {VISIT_TIME.format(new Date(v.start))}
                    {v.teammates.length ? ` · with ${v.teammates.join(', ')}` : ''}
                  </div>
                  <div className="text-muted-foreground">{v.location ?? 'Room not known yet'}</div>
                  {v.status === 'planned' && (
                    <div className="text-xs text-muted-foreground">Please keep this time free. We still confirm it with the lecturer and let you know if anything changes.</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ol className="grid gap-2 sm:grid-cols-2">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            {step.disabled ? (
              <span aria-disabled="true" title="Temporarily disabled"
                className="flex cursor-not-allowed items-center gap-3 rounded-lg border bg-white/60 px-4 py-3 text-sm font-medium text-muted-foreground/60">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted-foreground/30 text-xs font-semibold text-background tabular-nums">
                  {index + 1}
                </span>
                {step.title}
                <span className="ml-auto text-xs font-normal">Later</span>
              </span>
            ) : (
              <Link href={step.href} className="flex items-center gap-3 rounded-lg border bg-white px-4 py-3 text-sm font-medium hover:bg-black/[0.02]">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background tabular-nums">
                  {index + 1}
                </span>
                {step.title}
              </Link>
            )}
          </li>
        ))}
      </ol>

      <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Team availability</h2>
            {team.length > 0 && <span className="text-sm text-muted-foreground tabular-nums">{confirmed} of {team.length} confirmed</span>}
          </div>
          {team.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody has entered availability yet. Everyone with an account can add theirs under My availability.</p>
          ) : (
          <ul className="divide-y rounded-lg border bg-white">
            {team.map(member => (
              <li key={member.name} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                {member.status === 'confirmed'
                  ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                  : <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
                <span className="font-medium">{member.name}</span>
                <span className={cn('ml-auto text-xs', member.status === 'confirmed' ? 'text-emerald-700' : 'text-muted-foreground')}>
                  {member.status === 'confirmed'
                    ? `Confirmed ${new Date(member.confirmedAt!).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' })}`
                    : member.entries > 0 ? `${member.entries} ${member.entries === 1 ? 'time' : 'times'} entered, not confirmed` : 'Not confirmed'}
                </span>
              </li>
            ))}
          </ul>
          )}
        </section>
    </div>
  )
}
