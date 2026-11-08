import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyBridgeRequest } from '@/lib/outreach/bridge-auth'
import {
  getSettings, processInbound, queueFollowups, recordSent, storeInbound,
  type InboundItem, type SentResult,
} from '@/lib/outreach/engine'

export const dynamic = 'force-dynamic'

// Apps Script gives up on a request after about a minute; leave room for the response
const CLASSIFY_BUDGET_MS = 35_000

/**
 * Called by the Apps Script mail bridge at the end of each run with what it sent and the new
 * replies it found. Replies are classified here and follow-ups are queued for the next run.
 */
export async function POST(request: Request) {
  const auth = await verifyBridgeRequest(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = createAdminClient()
  const payload = (await request.json().catch(() => ({}))) as { sent?: SentResult[]; inbound?: InboundItem[] }

  try {
    const settings = await getSettings(db)
    await recordSent(db, payload.sent ?? [])
    const stored = await storeInbound(db, payload.inbound ?? [])
    const classified = await processInbound(db, settings, CLASSIFY_BUDGET_MS)
    const followups = settings.mode === 'off' ? 0 : await queueFollowups(db, settings)
    await db.from('mail_settings')
      .update({ last_bridge_at: new Date().toISOString() })
      .eq('id', true)
    return NextResponse.json({ ok: true, recorded: payload.sent?.length ?? 0, stored, classified, followups })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    await db.from('mail_settings').update({ last_bridge_error: message }).eq('id', true)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
