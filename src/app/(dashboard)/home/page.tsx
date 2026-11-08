import Link from 'next/link'

// The order is the workflow
const STEPS = [
  { title: 'Screen relevant lectures', href: '/lectures' },
  { title: 'Enter your availability', href: '/availability' },
  { title: 'Match lectures to free times', href: '/outreach' },
  { title: 'Run the outreach', href: '/outreach' },
]

/** First page after signing in: the workflow in four steps. */
export default function HomePage() {
  return (
    <div className="animate-fade-in-up mx-auto max-w-3xl space-y-8 pt-10">
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
    </div>
  )
}
