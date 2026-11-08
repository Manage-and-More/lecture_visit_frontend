import Link from 'next/link'
import { CheckCircle2, CircleDashed } from 'lucide-react'
import { getTeamStatus } from '@/app/actions/visit-planning'
import { cn } from '@/lib/utils'

// The order is the workflow
const STEPS = [
  { title: 'Screen relevant lectures', href: '/lectures' },
  { title: 'Enter your availability', href: '/availability' },
  { title: 'Match lectures to free times', href: '/outreach' },
  { title: 'Run the outreach', href: '/outreach' },
]

/** First page after signing in: the workflow in four steps, and who has committed their availability. */
export default async function HomePage() {
  const team = await getTeamStatus()
  const confirmed = team.filter(t => t.status === 'confirmed').length

  return (
    <div className="animate-fade-in-up mx-auto max-w-3xl space-y-10 pt-10">
      <div className="space-y-2">
        <h1 className="text-balance text-3xl font-semibold tracking-tight">Plan lecture visits</h1>
        <p className="text-muted-foreground">For Manage and More, at TUM and LMU.</p>
      </div>

      <ol className="grid gap-2 sm:grid-cols-2">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <Link href={step.href} className="flex items-center gap-3 rounded-lg border bg-white px-4 py-3 text-sm font-medium hover:bg-black/[0.02]">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background tabular-nums">
                {index + 1}
              </span>
              {step.title}
            </Link>
          </li>
        ))}
      </ol>

      {team.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Team availability</h2>
            <span className="text-sm text-muted-foreground tabular-nums">{confirmed} of {team.length} confirmed</span>
          </div>
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
                    : member.status === 'no_account'
                      ? 'No account yet'
                      : member.entries > 0 ? `${member.entries} ${member.entries === 1 ? 'time' : 'times'} entered, not confirmed` : 'Not confirmed'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
