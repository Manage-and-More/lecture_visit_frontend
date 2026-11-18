import { isAdmin } from '@/lib/auth'
import { LectureScreening } from '@/components/screening/lecture-screening'
import { TARGET_LIST_LOCKED } from '@/lib/screening/target-lock'

export default async function LecturesPage() {
  const admin = await isAdmin()
  return (
    <div className="animate-fade-in-up">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Lectures</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {TARGET_LIST_LOCKED
            ? 'The target lectures for outreach are final and shared by the whole team. They were chosen to reach as many different students as possible with few visits.'
            : 'Choose the target lectures for outreach, shared by the whole team. Lectures are ranked by estimated audience; aim to reach many programs with few visits.'}
        </p>
      </div>
      <LectureScreening canEdit={admin && !TARGET_LIST_LOCKED} locked={TARGET_LIST_LOCKED} />
    </div>
  )
}
