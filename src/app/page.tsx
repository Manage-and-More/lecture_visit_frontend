import Image from 'next/image'
import Link from 'next/link'
import { CalendarClock, ListFilter, Send, UsersRound, type LucideIcon } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'

type Step = {
  icon: LucideIcon
  title: string
  body: string
  where: { label: string; href: string }[]
}

// The order is the workflow: each step needs the one before it
const STEPS: Step[] = [
  {
    icon: ListFilter,
    title: 'Screen which lectures are relevant',
    body: 'Relevant lectures are the mandatory lectures of the study programs we target, plus lectures starred individually: of type Vorlesung, with sessions left this semester, and with at least one lecturer whose email address is known. Browse them week by week in the calendar with the filter "Target lectures".',
    where: [{ label: 'Calendar', href: '/calendar' }],
  },
  {
    icon: UsersRound,
    title: 'Enter the availability of lecture visitors',
    body: 'Everyone on the visit team adds when they are free, like booking a calendar event: drag over a day, adjust the times, and tick "Repeat every week" for regular free times. Visits are only ever planned inside these times.',
    where: [{ label: 'My availability', href: '/availability' }],
  },
  {
    icon: CalendarClock,
    title: 'Calculate matching lectures',
    body: 'A lecture matches when one of its sessions falls into someone\'s availability, with at least 30 minutes free from the start. The calendar shades the times people are free, and the lecturer finder on the outreach page suggests only matching lectures and shows which session fits whom.',
    where: [{ label: 'Calendar', href: '/calendar' }, { label: 'Outreach', href: '/outreach' }],
  },
  {
    icon: Send,
    title: 'Execute the outreach',
    body: 'Queue the matching lecturers. The tool sends one email per lecturer from Gmail, reminds once after a week and reads the replies. After a yes, "Propose visits" in the calendar picks a session where two team members are free; accepting it emails the lecturer the date.',
    where: [{ label: 'Outreach', href: '/outreach' }, { label: 'Calendar', href: '/calendar' }],
  },
]

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const cta = user ? { label: 'Open the app', href: '/outreach' } : { label: 'Sign in', href: '/auth/login' }

  return (
    <main className="min-h-screen bg-[#fafaf9] text-foreground">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/logo.png" alt="" width={28} height={28} className="rounded" />
          <span className="text-sm font-semibold tracking-tight">Lecture Visit Tool</span>
        </Link>
        <Link href={cta.href} className="rounded-md bg-foreground px-3.5 py-2 text-sm font-medium text-background hover:opacity-90">
          {cta.label}
        </Link>
      </header>

      <section className="mx-auto max-w-5xl px-4 pb-12 pt-10 sm:px-6 sm:pt-16">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Manage and More · UnternehmerTUM</p>
        <h1 className="mt-3 max-w-3xl text-balance text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          Plan lecture visits, from the right lecture to the confirmed date
        </h1>
        <p className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
          The tool finds lectures at TUM and LMU worth visiting, matches them with the times the visit team is free,
          emails the lecturers and plans who goes where. Four steps, in this order:
        </p>
      </section>

      <section aria-label="How it works" className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
        <ol className="grid gap-4 md:grid-cols-2">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex flex-col gap-4 rounded-xl border bg-white p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-sm font-semibold text-background tabular-nums">
                  {index + 1}
                </span>
                <step.icon className="h-5 w-5 text-muted-foreground" aria-hidden />
              </div>
              <div className="space-y-2">
                <h2 className="text-balance text-lg font-semibold tracking-tight">{step.title}</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
              </div>
              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                {step.where.map(w => (
                  <Link key={w.href} href={w.href}
                    className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-black/[0.03]">
                    {w.label} →
                  </Link>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-5xl px-4 pb-20 sm:px-6">
        <div className="grid gap-6 rounded-xl border bg-white p-6 text-sm leading-relaxed text-muted-foreground md:grid-cols-3">
          <div>
            <h3 className="mb-1 font-semibold text-foreground">Who does what</h3>
            <p>Every member of the visit team enters their availability. Admins screen lectures, run the outreach and accept visits.</p>
          </div>
          <div>
            <h3 className="mb-1 font-semibold text-foreground">Safe to try</h3>
            <p>In test mode every email goes to the sender&apos;s own inbox. Lecturers only receive emails once sending is switched to live.</p>
          </div>
          <div>
            <h3 className="mb-1 font-semibold text-foreground">Getting access</h3>
            <p>Team members are invited by email and set their own password. Ask an admin if you need an invitation.</p>
          </div>
        </div>
      </section>
    </main>
  )
}
