// Lets the outreach scripts run with the variable names of tum_scraper/.env as well as the app's.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= process.env.SUPABASE_URL
process.env.SUPABASE_SERVICE_ROLE_KEY ??= process.env.SUPABASE_SERVICE_KEY

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY (for example: set -a; source ../tum_scraper/.env; set +a)')
  process.exit(1)
}
