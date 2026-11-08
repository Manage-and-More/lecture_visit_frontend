import { createClient } from '@/lib/supabase/server'
import { ProfileSettings } from '@/components/settings/profile-settings'
import { ActiveSemesterSettings } from '@/components/settings/active-semester-settings'
import { ensureActiveSemester, getCurrentUserProfile } from '@/app/actions/settings'

export default async function SettingsPage() {
  const supabase = await createClient()

  // Ensure active_semester exists
  await ensureActiveSemester()

  // Get current user profile
  const profile = await getCurrentUserProfile().catch(() => null)

  const { data: parameters } = await supabase
    .from('parameters')
    .select('*')
    .order('key')

  const activeSemester = parameters?.find(p => p.key === 'active_semester')?.value ?? 'SoSe 2026'

  return (
    <div className="animate-fade-in-up">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your profile and the semester being planned
        </p>
      </div>

      <div className="space-y-6">
        <ProfileSettings profile={profile} />
        <ActiveSemesterSettings activeSemester={activeSemester} />
      </div>
    </div>
  )
}
