// Loads the Supabase service credentials for local scripts. Imported first, because
// '../outreach/env' checks them at import time. Defaults to the scraper's env file next to
// this repository; MAIL_BRIDGE_ENV_FILE points elsewhere.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

if (!process.env.SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
  const file = process.env.MAIL_BRIDGE_ENV_FILE ?? path.resolve(__dirname, '../../../tum_scraper/.env')
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '')
    }
  }
}
