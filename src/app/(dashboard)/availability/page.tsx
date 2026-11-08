import { amIOnTheTeam, getMyAvailability, getMyConfirmation, getMyVisits } from '@/app/actions/visit-planning'
import { ConfirmAvailability } from '@/components/availability/confirm-availability'
import { AvailabilityCalendar } from '@/components/availability/availability-calendar'

export default async function AvailabilityPage() {
  const [entries, visits, onTeam, confirmedAt] = await Promise.all([getMyAvailability(), getMyVisits(), amIOnTheTeam(), getMyConfirmation()])

  return (
    <div className="animate-fade-in-up space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My availability</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Add the times you can visit a lecture, on single days or repeating every week.
        </p>
      </div>
      {!onTeam && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          You&apos;re not on the current visit team, so visits won&apos;t be planned for you. Ask an admin to add you.
        </p>
      )}
      <ConfirmAvailability confirmedAt={confirmedAt} hasEntries={entries.length > 0} />
      <AvailabilityCalendar entries={entries} />
      <section className="rounded-lg border bg-white p-4 text-sm space-y-2">
        <h2 className="font-medium">My upcoming visits</h2>
        {visits.length === 0 ? <p className="text-muted-foreground">No visits planned for you yet.</p> : (
          <ul className="divide-y">
            {visits.map(v => (
              <li key={v.id} className="py-2">
                <div className="font-medium">
                  {new Date(v.start).toLocaleString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })} · {v.title}
                </div>
                <div className="text-muted-foreground">
                  {v.location ?? 'Room not known'}{v.teammates.length ? ` · with ${v.teammates.join(', ')}` : ''}
                  {v.status === 'planned' ? ' · proposed, not confirmed yet' : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
