import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyBridgeRequest } from '@/lib/outreach/bridge-auth'
import { getSettings, leaseOutbox, trackedThreadIds } from '@/lib/outreach/engine'

export const dynamic = 'force-dynamic'

/**
 * Called by the Apps Script mail bridge at the start of each run. Returns the emails to send
 * now and the Gmail threads to watch for replies. `{ dryRun: true }` only checks the connection.
 */
export async function POST(request: Request) {
  const auth = await verifyBridgeRequest(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = createAdminClient()
  const payload = (await request.json().catch(() => ({}))) as { dryRun?: boolean }
  const settings = await getSettings(db)
  await db.from('mail_settings')
    .update({ last_bridge_at: new Date().toISOString(), bridge_audience: auth.audience })
    .eq('id', true)

  if (payload.dryRun) {
    return NextResponse.json({ ok: true, mode: settings.mode, account: auth.email, audience: auth.audience, outbox: [], trackedThreadIds: [] })
  }

  try {
    const { outbox, blocked } = await leaseOutbox(db, settings)
    const threads = await trackedThreadIds(db)
    await db.from('mail_settings')
      .update({ last_bridge_error: blocked.length ? blocked.join('\n') : null })
      .eq('id', true)
    return NextResponse.json({ ok: true, mode: settings.mode, outbox, trackedThreadIds: threads, blocked })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    await db.from('mail_settings').update({ last_bridge_error: message }).eq('id', true)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
