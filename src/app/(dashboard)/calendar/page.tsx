import { isAdmin } from '@/lib/auth'
import { VisitCalendar } from '@/components/calendar/visit-calendar'

export default async function CalendarPage() {
  const admin = await isAdmin()
  return (
    <div className="animate-fade-in-up">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
        <p className="text-sm text-muted-foreground mt-1">
          When lectures take place, who is free, and the planned visits
        </p>
      </div>
      {admin ? <VisitCalendar /> : (
        <div className="rounded-lg border bg-white p-6 text-sm text-muted-foreground">
          Only admins can plan visits. Enter your free times under &quot;My availability&quot;.
        </div>
      )}
    </div>
  )
}
