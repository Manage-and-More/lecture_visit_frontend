/**
 * Emails to the members who visit a lecture (not to lecturers).
 *
 * sendVisitConfirmations: as soon as a visit is confirmed (a lecturer's yes, or by hand), its
 * members get a short email saying so, with what the lecturer said. The mail bridge calls it on
 * every run; a visit is marked in its notes so nobody gets the same confirmation twice.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Transporter } from 'nodemailer'
import type { MailSettings } from '@/types/database'

export const CONFIRM_MARK = 'Confirmation sent to member'

const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Berlin' })
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Berlin' })

type Row = {
  id: string; scheduled_for: string; location: string | null; notes: string | null; assignee_ids: string[]
  lecture: { title: string } | null
  outreach: { ai_summary: string | null } | null
}

export async function sendVisitConfirmations(
  db: SupabaseClient, settings: MailSettings, smtp: Transporter | null, options: { dryRun?: boolean } = {},
): Promise<number> {
  const { data, error } = await db.from('visits')
    .select('id, scheduled_for, location, notes, assignee_ids, lecture:lectures(title), outreach:professor_outreach(ai_summary)')
    .eq('status', 'confirmed').gte('scheduled_for', new Date().toISOString()).order('scheduled_for')
  if (error) throw error
  const visits = ((data ?? []) as unknown as Row[]).filter(v => !(v.notes ?? '').includes(CONFIRM_MARK))
  if (visits.length === 0) return 0
  const ids = [...new Set(visits.flatMap(v => v.assignee_ids))]
  const { data: profiles } = await db.from('profiles').select('id, email, display_name').in('id', ids)
  const people = new Map((profiles ?? []).map(p => [p.id as string, { email: (p.email as string | null) ?? '', name: ((p.display_name as string | null)?.trim() || (p.email as string | null)) ?? '' }]))
  const signature = settings.sender_name.split(' ')[0]

  let sent = 0
  for (const v of visits) {
    const start = new Date(v.scheduled_for)
    const title = v.lecture?.title ?? 'the lecture'
    for (const id of v.assignee_ids) {
      const person = people.get(id)
      if (!person?.email) continue
      const subject = `Confirmed: lecture visit on ${DAY.format(start)}, ${TIME.format(start)}`
      const text = [
        `Hi ${person.name.split(' ')[0]},`, '',
        `good news: the lecturer confirmed your visit to “${title}” on ${DAY.format(start)}, at the start of the session at ${TIME.format(start)}.`,
        ...(v.outreach?.ai_summary ? ['', `What the lecturer said: ${v.outreach.ai_summary}`] : []), '',
        `Where: ${v.location ?? 'room to be announced'}`, '',
        "Your calendar entry stays as it is. If anything changes, I'll let you know.", '',
        'Best,', signature,
      ].join('\n')
      if (options.dryRun || !smtp) {
        console.log(`Would send confirmation: ${subject} → ${person.name}`)
        continue
      }
      await smtp.sendMail({ from: { name: settings.sender_name, address: settings.sender_email }, to: person.email, subject, text })
      sent++
      console.log(`Confirmation sent: ${subject} → ${person.name}`)
    }
    if (!options.dryRun && smtp) {
      await db.from('visits').update({ notes: `${v.notes ? `${v.notes}; ` : ''}${CONFIRM_MARK} ${new Date().toISOString().slice(0, 10)}`, updated_at: new Date().toISOString() }).eq('id', v.id)
    }
  }
  return sent
}
