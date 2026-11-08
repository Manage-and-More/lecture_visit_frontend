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
    settings: await getSettings(supabase),
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

export type AvailabilitySlot = { weekday: number; start: string; end: string } // "HH:MM"

export async function getMyAvailability(): Promise<AvailabilitySlot[]> {
  const { supabase, userId } = await requireUser()
  const { data, error } = await supabase.from('member_availability')
    .select('weekday, start_time, end_time').eq('profile_id', userId).order('weekday').order('start_time')
  if (error) throw error
  return (data ?? []).map(s => ({
    weekday: s.weekday as number,
    start: fromMinutes(toMinutes(s.start_time as string)),
    end: fromMinutes(toMinutes(s.end_time as string)),
  }))
}

export async function saveMyAvailability(slots: AvailabilitySlot[]): Promise<void> {
  const { supabase, userId } = await requireUser()
  for (const s of slots) {
    if (s.weekday < 1 || s.weekday > 7 || toMinutes(s.end) <= toMinutes(s.start)) throw new Error('Invalid time slot')
  }
  const { error: deleteError } = await supabase.from('member_availability').delete().eq('profile_id', userId)
  if (deleteError) throw deleteError
  if (slots.length) {
    const { error } = await supabase.from('member_availability').insert(
      slots.map(s => ({ profile_id: userId, weekday: s.weekday, start_time: s.start, end_time: s.end })),
    )
    if (error) throw error
  }
  revalidatePath('/availability')
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
