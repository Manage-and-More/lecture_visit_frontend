import { getOutreachOverview } from '@/app/actions/outreach'
import { OutreachDashboard } from '@/components/outreach/outreach-dashboard'

export default async function OutreachPage() {
  const overview = await getOutreachOverview()

  return (
    <div className="animate-fade-in-up">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Outreach</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Emails to lecturers for {overview.semester}: sent automatically from Gmail, replies read by AI
        </p>
      </div>
      {overview.isAdmin && overview.settings ? (
        <OutreachDashboard overview={overview} settings={overview.settings} />
      ) : (
        <div className="rounded-lg border bg-white p-6 text-sm text-muted-foreground">
          Only admins can manage outreach. To take part in visits, enter your free times under{' '}
          <a href="/availability" className="underline">My availability</a>.
        </div>
      )}
    </div>
  )
}
