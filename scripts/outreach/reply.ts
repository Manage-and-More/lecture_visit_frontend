/**
 * Queues an answer to a lecturer's reply, sent in their thread with the next mail bridge run.
 * The text may contain "[[attach: file.pdf]]" lines; the bridge attaches those files from its
 * attachments folder (../lecture_visit_data/attachments by default).
 *
 *   npx tsx scripts/outreach/reply.ts <inbound message id> <text file> [--dry-run]
 */
import '../mail-bridge/load-env'
import './env'
import { readFileSync } from 'node:fs'
import { createAdminClient } from '@/lib/supabase/admin'
import { queueReplyTo } from '@/lib/outreach/engine'
import { attachmentsOf } from '@/lib/outreach/templates'
import type { EmailMessage } from '@/types/database'

async function main() {
  const [messageId, file] = process.argv.slice(2).filter(a => !a.startsWith('--'))
  const dryRun = process.argv.includes('--dry-run')
  if (!messageId || !file) throw new Error('Usage: reply.ts <inbound message id> <text file> [--dry-run]')
  const body = readFileSync(file, 'utf8').trim()
  const db = createAdminClient()
  const { data } = await db.from('email_messages').select('*').eq('id', messageId).single()
  const inbound = data as EmailMessage | null
  if (!inbound || inbound.direction !== 'inbound') throw new Error('Not an inbound message')
  const { files } = attachmentsOf(body)
  console.log(`To ${inbound.from_email}, re: ${inbound.subject}${files.length ? `, attachments: ${files.join(', ')}` : ''}\n\n${body}`)
  if (dryRun) return
  await queueReplyTo(db, inbound, body)
  console.log('\nQueued; it goes out with the next mail bridge run.')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
