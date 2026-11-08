'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Parameter, Profile } from '@/types/database'

export async function getCurrentUserProfile() {
  const supabase = await createClient()

  // Get the current user
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) throw new Error('Not authenticated')

  // Get the profile
  let { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  // If profile doesn't exist, create it
  if (error?.code === 'PGRST116') {
    const { data: newProfile, error: insertError } = await supabase
      .from('profiles')
      .insert({
        id: user.id,
        display_name: user.email?.split('@')[0] || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single()

    if (insertError) throw insertError
    return newProfile
  }

  if (error) throw error
  return data
}

export async function updateUserProfile(displayName: string) {
  const supabase = await createClient()

  // Get the current user
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) throw new Error('Not authenticated')

  // Update the profile
  const { error } = await supabase
    .from('profiles')
    .update({
      display_name: displayName,
      updated_at: new Date().toISOString()
    })
    .eq('id', user.id)

  if (error) throw error
  revalidatePath('/settings')
}

export async function ensureActiveSemester(): Promise<void> {
  const supabase = await createClient()

  // Check if active_semester exists
  const { data } = await supabase
    .from('parameters')
    .select('key')
    .eq('key', 'active_semester')
    .single()

  if (!data) {
    // Insert active_semester if it doesn't exist
    await supabase
      .from('parameters')
      .insert({
        key: 'active_semester',
        value: 'SoSe 2026'
      })
  }
}

export async function updateActiveSemester(semester: string): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('parameters')
    .update({ value: semester })
    .eq('key', 'active_semester')

  if (error) throw error
  revalidatePath('/settings')
}
