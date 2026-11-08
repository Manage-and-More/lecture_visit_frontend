import { isAdmin } from '@/lib/auth'
import { LectureScreening } from '@/components/screening/lecture-screening'

export default async function LecturesPage() {
  const admin = await isAdmin()
  return (
    <div className="animate-fade-in-up">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Lectures</h1>
        <p className="text-sm text-muted-foreground mt-1">
          All scraped lectures, ranked by estimated audience. Mark the ones worth visiting; aim to reach many programs with few visits.
        </p>
      </div>
      <LectureScreening canEdit={admin} />
    </div>
  )
}
