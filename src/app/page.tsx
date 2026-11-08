import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

// The order is the workflow
const STEPS = [
  { title: 'Screen relevant lectures', href: '/calendar' },
  { title: 'Enter your availability', href: '/availability' },
  { title: 'Match lectures to free times', href: '/outreach' },
  { title: 'Run the outreach', href: '/outreach' },
]

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const cta = user ? { label: 'Open the app', href: '/outreach' } : { label: 'Sign in', href: '/auth/login' }

  return (
    <main className="flex min-h-screen flex-col bg-[#fafaf9] px-4 sm:px-6">
      <header className="mx-auto flex w-full max-w-3xl items-center gap-2.5 py-5">
        <Image src="/logo.png" alt="" width={28} height={28} className="rounded" />
        <span className="text-sm font-semibold tracking-tight">Lecture Visit Tool</span>
      </header>

      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 pb-24">
        <div className="space-y-3">
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">Plan lecture visits</h1>
          <p className="text-lg text-muted-foreground">For Manage and More, at TUM and LMU.</p>
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

        <div>
          <Link href={cta.href} className="inline-block rounded-md bg-foreground px-4 py-2.5 text-sm font-medium text-background hover:opacity-90">
            {cta.label}
          </Link>
        </div>
      </section>
    </main>
  )
}
