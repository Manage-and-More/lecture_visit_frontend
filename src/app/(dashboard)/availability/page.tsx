import { getMyAvailability, getMyVisits } from '@/app/actions/visit-planning'
import { AvailabilityEditor } from '@/components/availability/availability-editor'

export default async function AvailabilityPage() {
  const [slots, visits] = await Promise.all([getMyAvailability(), getMyVisits()])

  return (
    <div className="animate-fade-in-up space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My availability</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Mark the times you can usually visit a lecture. Visits are planned only in times you marked.
        </p>
      </div>
      <AvailabilityEditor initialSlots={slots} />
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
