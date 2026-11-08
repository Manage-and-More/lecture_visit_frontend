'use server'

import { revalidatePath } from 'next/cache'
import { activeSemester, requireAdmin, requireUser } from '@/lib/auth'
import { getSettings } from '@/lib/outreach/engine'
import { loadCalendarWeek, type CalendarScope, type CalendarWeek } from '@/lib/scheduling/calendar'
import { proposeVisits, queueVisitConfirmation, type ProposalResult } from '@/lib/scheduling/auto'
import { fromDateKey, fromMinutes, mondayOf, toMinutes } from '@/lib/scheduling/time'
import type { Visit } from '@/types/database'

export async function getCalendarWeek(options: {
  weekStart: string // YYYY-MM-DD, any day of the week
  scope: CalendarScope
  university: string
  search: string
}): Promise<CalendarWeek> {
  const { supabase } = await requireAdmin()
  return loadCalendarWeek(supabase, {
    semester: await activeSemester(supabase),
    weekStart: mondayOf(fromDateKey(options.weekStart)),
    scope: options.scope,
    university: options.university,
    search: options.search,
  })
}

export async function proposeVisitsAction(weeksAhead: number): Promise<ProposalResult> {
  const { supabase } = await requireAdmin()
  const result = await proposeVisits(supabase, await activeSemester(supabase), { weeksAhead })
  revalidatePath('/calendar')
  return result
}

export async function createVisit(input: {
  lectureId: string
  outreachId: string | null
  start: string // ISO
  location: string | null
  assigneeIds: string[]
}): Promise<void> {
  const { supabase } = await requireAdmin()
  const { error } = await supabase.from('visits').insert({
    lecture_id: input.lectureId,
    outreach_id: input.outreachId,
    semester: await activeSemester(supabase),
    scheduled_for: input.start,
    location: input.location,
    assignee_ids: input.assigneeIds,
    status: 'planned',
    notes: 'Planned by hand',
  })
  if (error) throw error
  revalidatePath('/calendar')
}

export async function updateVisitAssignees(visitId: string, assigneeIds: string[]): Promise<void> {
  const { supabase } = await requireAdmin()
  const { error } = await supabase.from('visits')
    .update({ assignee_ids: assigneeIds, updated_at: new Date().toISOString() }).eq('id', visitId)
  if (error) throw error
  revalidatePath('/calendar')
}

/** Accepts a proposed visit and queues the date confirmation to the lecturer. */
export async function acceptVisit(visitId: string): Promise<{ emailQueued: boolean }> {
  const { supabase } = await requireAdmin()
  const { data: visit, error } = await supabase.from('visits')
    .update({ status: 'confirmed', updated_at: new Date().toISOString() })
    .eq('id', visitId).eq('status', 'planned')
    .select('*').single()
  if (error || !visit) throw new Error('Visit not found or already accepted')
  const emailQueued = await queueVisitConfirmation(supabase, await getSettings(supabase), visit as Visit)
  revalidatePath('/calendar')
  revalidatePath('/outreach')
  return { emailQueued }
}

/** Removes a proposal, or cancels an accepted visit (no email is sent automatically). */
export async function discardVisit(visitId: string): Promise<void> {
  const { supabase } = await requireAdmin()
  const { data: visit } = await supabase.from('visits').select('status').eq('id', visitId).single()
  if (!visit) throw new Error('Visit not found')
  const { error } = visit.status === 'planned'
    ? await supabase.from('visits').delete().eq('id', visitId)
    : await supabase.from('visits').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', visitId)
  if (error) throw error
  revalidatePath('/calendar')
}

/** One availability entry of the signed-in member, as shown on "My availability". */
export type AvailabilityEntry = {
  id: string
  date: string // YYYY-MM-DD, first (or only) day
  start: string // "HH:MM"
  end: string
  repeatsWeekly: boolean
  repeatUntil: string | null
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/

/** Whether the signed-in user is on the current visit team (public.team_members). */
export async function amIOnTheTeam(): Promise<boolean> {
  const { supabase, userId } = await requireUser()
  const { data: profile } = await supabase.from('profiles').select('email').eq('id', userId).single()
  if (!profile?.email) return false
  const { data } = await supabase.from('team_members').select('email').eq('email', (profile.email as string).toLowerCase()).maybeSingle()
  return Boolean(data)
}

export async function getMyAvailability(): Promise<AvailabilityEntry[]> {
  const { supabase, userId } = await requireUser()
  const { data, error } = await supabase.from('member_availability')
    .select('id, date, start_time, end_time, repeats_weekly, repeat_until')
    .eq('profile_id', userId).order('date').order('start_time')
  if (error) throw error
  return (data ?? []).map(s => ({
    id: s.id as string,
    date: s.date as string,
    start: fromMinutes(toMinutes(s.start_time as string)),
    end: fromMinutes(toMinutes(s.end_time as string)),
    repeatsWeekly: s.repeats_weekly as boolean,
    repeatUntil: (s.repeat_until as string | null) ?? null,
  }))
}

/** Creates an entry, or updates one of the member's own entries when `id` is given. */
export async function saveAvailabilityEntry(entry: Omit<AvailabilityEntry, 'id'> & { id?: string }): Promise<void> {
  const { supabase, userId } = await requireUser()
  if (!DATE_RE.test(entry.date) || !TIME_RE.test(entry.start) || !TIME_RE.test(entry.end)) {
    throw new Error('Enter a date and start and end times')
  }
  if (toMinutes(entry.end) <= toMinutes(entry.start)) throw new Error('The end has to be after the start')
  const repeatUntil = entry.repeatsWeekly && entry.repeatUntil ? entry.repeatUntil : null
  if (repeatUntil && (!DATE_RE.test(repeatUntil) || repeatUntil < entry.date)) {
    throw new Error('"Until" has to be on or after the first day')
  }
  const row = {
    profile_id: userId,
    date: entry.date,
    start_time: entry.start,
    end_time: entry.end,
    repeats_weekly: entry.repeatsWeekly,
    repeat_until: repeatUntil,
  }
  const { error } = entry.id
    ? await supabase.from('member_availability').update(row).eq('id', entry.id).eq('profile_id', userId)
    : await supabase.from('member_availability').insert(row)
  if (error) throw error
  await clearConfirmation(supabase, userId)
  revalidatePath('/availability')
}

type SessionClient = Awaited<ReturnType<typeof requireUser>>['supabase']

/** A change to the entries means the member has to confirm again. */
async function clearConfirmation(supabase: SessionClient, userId: string) {
  await supabase.from('availability_confirmations').delete().eq('profile_id', userId)
  revalidatePath('/home')
}

export async function deleteAvailabilityEntry(id: string): Promise<void> {
  const { supabase, userId } = await requireUser()
  const { error } = await supabase.from('member_availability').delete().eq('id', id).eq('profile_id', userId)
  if (error) throw error
  await clearConfirmation(supabase, userId)
  revalidatePath('/availability')
}

/** When the signed-in member last committed their availability, or null if not (since the last change). */
export async function getMyConfirmation(): Promise<string | null> {
  const { supabase, userId } = await requireUser()
  const { data } = await supabase.from('availability_confirmations').select('confirmed_at').eq('profile_id', userId).maybeSingle()
  return (data?.confirmed_at as string | undefined) ?? null
}

/** Commits the member's current availability: from now on it counts for matching and scheduling. */
export async function confirmMyAvailability(): Promise<void> {
  const { supabase, userId } = await requireUser()
  const { count } = await supabase.from('member_availability').select('id', { count: 'exact', head: true }).eq('profile_id', userId)
  if (!count) throw new Error('Add at least one time you are free before confirming')
  const { error } = await supabase.from('availability_confirmations')
    .upsert({ profile_id: userId, confirmed_at: new Date().toISOString() }, { onConflict: 'profile_id' })
  if (error) throw error
  revalidatePath('/availability')
  revalidatePath('/home')
}

export type TeamStatus = {
  name: string
  status: 'confirmed' | 'not_confirmed' | 'no_account'
  confirmedAt: string | null
  entries: number
}

/** The visit team and whether each member has committed their availability (shown on Home). */
export async function getTeamStatus(): Promise<TeamStatus[]> {
  const { supabase } = await requireUser()
  const { data: team } = await supabase.from('team_members').select('email, name').order('name')
  const emails = (team ?? []).map(t => (t.email as string).toLowerCase())
  if (emails.length === 0) return []
  const { data: profiles } = await supabase.from('profiles').select('id, email').in('email', emails)
  const idByEmail = new Map((profiles ?? []).map(p => [(p.email as string).toLowerCase(), p.id as string]))
  const ids = [...idByEmail.values()]
  const [{ data: confirmations }, { data: entries }] = await Promise.all([
    ids.length ? supabase.from('availability_confirmations').select('profile_id, confirmed_at').in('profile_id', ids) : Promise.resolve({ data: [] }),
    ids.length ? supabase.from('member_availability').select('profile_id').in('profile_id', ids) : Promise.resolve({ data: [] }),
  ])
  const confirmedAt = new Map((confirmations ?? []).map(c => [c.profile_id as string, c.confirmed_at as string]))
  const entryCount = new Map<string, number>()
  for (const e of entries ?? []) entryCount.set(e.profile_id as string, (entryCount.get(e.profile_id as string) ?? 0) + 1)
  return (team ?? []).map(t => {
    const id = idByEmail.get((t.email as string).toLowerCase())
    const at = id ? confirmedAt.get(id) ?? null : null
    return {
      name: t.name as string,
      status: !id ? 'no_account' : at ? 'confirmed' : 'not_confirmed',
      confirmedAt: at,
      entries: id ? entryCount.get(id) ?? 0 : 0,
    }
  })
}

export type MyVisit = { id: string; title: string; start: string; location: string | null; status: string; teammates: string[] }

export async function getMyVisits(): Promise<MyVisit[]> {
  const { supabase, userId } = await requireUser()
  const { data, error } = await supabase.from('visits')
    .select('id, scheduled_for, location, status, assignee_ids, lecture:lectures(title)')
    .contains('assignee_ids', [userId])
    .in('status', ['planned', 'confirmed'])
    .gte('scheduled_for', new Date().toISOString())
    .order('scheduled_for')
  if (error) throw error
  const rows = (data ?? []) as unknown as { id: string; scheduled_for: string; location: string | null; status: string; assignee_ids: string[]; lecture: { title: string } | null }[]
  const otherIds = [...new Set(rows.flatMap(r => r.assignee_ids).filter(id => id !== userId))]
  const { data: profiles } = otherIds.length
    ? await supabase.from('profiles').select('id, display_name, email').in('id', otherIds)
    : { data: [] }
  const names = new Map((profiles ?? []).map(p => [p.id as string, (p.display_name as string | null) || (p.email as string)]))
  return rows.map(r => ({
    id: r.id,
    title: r.lecture?.title ?? 'Lecture',
    start: r.scheduled_for,
    location: r.location,
    status: r.status,
    teammates: r.assignee_ids.filter(id => id !== userId).map(id => names.get(id) ?? 'Member'),
  }))
}

export type ProposedVisit = {
  id: string
  title: string
  start: string
  location: string | null
  notes: string | null
  team: string[]
  lecturer: string
}

/** Visits proposed (automatically or by hand) and not yet accepted, in all weeks. */
export async function getProposedVisits(): Promise<ProposedVisit[]> {
  const { supabase } = await requireAdmin()
  const { data, error } = await supabase.from('visits')
    .select('id, scheduled_for, location, notes, assignee_ids, lecture:lectures(title), outreach:professor_outreach(professor:professors(title, first_name, last_name))')
    .eq('status', 'planned')
    .order('scheduled_for')
  if (error) throw error
  type Row = {
    id: string; scheduled_for: string; location: string | null; notes: string | null; assignee_ids: string[]
    lecture: { title: string } | null
    outreach: { professor: { title: string | null; first_name: string | null; last_name: string | null } | null } | null
  }
  const rows = (data ?? []) as unknown as Row[]
  const ids = [...new Set(rows.flatMap(r => r.assignee_ids))]
  const { data: profiles } = ids.length
    ? await supabase.from('profiles').select('id, display_name, email').in('id', ids)
    : { data: [] }
  const names = new Map((profiles ?? []).map(p => [p.id as string, (p.display_name as string | null) || (p.email as string)]))
  return rows.map(r => {
    const p = r.outreach?.professor
    return {
      id: r.id,
      title: r.lecture?.title ?? 'Lecture',
      start: r.scheduled_for,
      location: r.location,
      notes: r.notes,
      team: r.assignee_ids.map(id => names.get(id) ?? 'Member'),
      lecturer: p ? [p.title, p.first_name, p.last_name].filter(Boolean).join(' ') : '',
    }
  })
}
