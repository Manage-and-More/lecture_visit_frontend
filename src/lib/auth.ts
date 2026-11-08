import { createClient } from '@/lib/supabase/server'

/** The signed-in user's Supabase client, or an error if nobody is signed in. */
export async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  return { supabase, userId: user.id }
}

export async function requireAdmin() {
  const { supabase, userId } = await requireUser()
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', userId).single()
  if (!profile?.is_admin) throw new Error('Only admins can do this')
  return { supabase, userId }
}

export async function isAdmin(): Promise<boolean> {
  try {
    await requireAdmin()
    return true
  } catch {
    return false
  }
}

export async function activeSemester(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string> {
  const { data } = await supabase.from('parameters').select('value').eq('key', 'active_semester').single()
  return data?.value ?? 'WiSe 2026/27'
}
