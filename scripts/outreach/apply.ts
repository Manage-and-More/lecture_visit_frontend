/**
 * Publishes decisions on lecturer replies made in a Claude Code session: stores each
 * classification, updates the thread (and lecture answers), queues the automatic thank-you
 * or the given reply, and puts opt-outs on the do-not-contact list. Emails go out with the
 * next Gmail check-in, within the sending mode and daily limit.
 *
 *   npx tsx scripts/outreach/apply.ts decisions.json [--dry-run]
 */
import './env'
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { ClassificationSchema } from '@/lib/outreach/classify'
import { applyClassification, getSettings, queueReplyTo } from '@/lib/outreach/engine'
import type { EmailMessage, ReplyClassification } from '@/types/database'

const DecisionsSchema = z.array(z.object({
  messageId: z.string().uuid(),
  classification: ClassificationSchema,
  reply: z.string().min(1).optional(),
}))

async function main() {
  const file = process.argv[2]
  const dryRun = process.argv.includes('--dry-run')
  if (!file) {
    console.error('Usage: npx tsx scripts/outreach/apply.ts decisions.json [--dry-run]')
    process.exit(1)
  }
  const decisions = DecisionsSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
  const db = createAdminClient()
  const settings = await getSettings(db)
  console.log(`${dryRun ? 'Dry run: nothing is written. ' : ''}Sending mode: ${settings.mode}. ${decisions.length} decisions.\n`)

  for (const decision of decisions) {
    const { data: message } = await db.from('email_messages').select('*').eq('id', decision.messageId).maybeSingle()
    const inbound = message as EmailMessage | null
    if (!inbound || inbound.direction !== 'inbound' || inbound.kind !== 'reply') {
      console.log(`- ${decision.messageId}: not an inbound reply, skipped`)
      continue
    }
    if (inbound.classified_at) {
      console.log(`- ${decision.messageId}: already handled at ${inbound.classified_at}, skipped`)
      continue
    }
    const c = decision.classification as ReplyClassification
    const plan = `${c.category} (${c.confidence})${c.needs_human ? ', flagged for a person' : ''}${decision.reply ? ', reply queued' : ''}`
    if (dryRun) {
      console.log(`- ${decision.messageId} from ${inbound.from_email}: would apply ${plan}`)
      continue
    }

    await db.from('email_messages')
      .update({ classification: c, classified_at: new Date().toISOString(), processing_error: null })
      .eq('id', inbound.id)
    await applyClassification(db, settings, inbound, c, { skipAutoReply: Boolean(decision.reply) })
    if (decision.reply) await queueReplyTo(db, inbound, decision.reply)

    const { data: thread } = await db.from('professor_outreach')
      .select('status, attention_reason').eq('id', inbound.outreach_id).single()
    console.log(`- ${inbound.from_email}: ${plan} → thread ${thread?.status}${thread?.attention_reason ? ` (${thread.attention_reason})` : ''}`)
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
