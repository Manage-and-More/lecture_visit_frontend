import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <h2 className="text-xl font-semibold">Page not found</h2>
      <p className="text-muted-foreground text-sm">The page you&apos;re looking for doesn&apos;t exist.</p>
      <Link href="/outreach" className="text-sm text-primary underline-offset-4 hover:underline">Go to Outreach</Link>
    </div>
  )
}
