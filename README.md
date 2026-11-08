# Lecture Visit Frontend

Internal coordination tool for planning and managing lecture visits — short promotional appearances during the first lectures of the semester at Munich universities (LMU & TUM).

## What It Does

Before each semester, the club identifies which lectures to visit, contacts professors (without emailing the same person twice), and coordinates who visits which lecture. This app is the command center for that process.

### Core Features (Planned)

- **Browse & filter** lectures across universities, study programs, and semesters
- **Professor-level deduplication** — one outreach per professor, regardless of how many lectures they teach
- **Outreach tracking** — status per professor per semester (not contacted → emailed → confirmed / declined)
- **Visit assignments** — who from the club visits which lecture, and when
- **Email draft generation** — templated outreach with professor/lecture context

## Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS + shadcn/ui (via `class-variance-authority`, `clsx`, `tailwind-merge`)
- **Backend / DB**: Supabase (PostgreSQL) — 11 tables across 5 migrations
- **Auth**: Supabase Auth with `profiles` table (club-internal only)
- **Icons**: Lucide React

## Getting Started

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.local.example .env.local
# Fill in your Supabase URL and anon key

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |

## Deployment

Hosted on [Fly.io](https://fly.io) as app `mm-lecture-visit` (region `fra`): https://mm-lecture-visit.fly.dev

- **Release:** open a PR from `main` into `production`. Merging it runs `.github/workflows/deploy.yml`, which builds the `Dockerfile` on Fly's builders and rolls it out. A manual `fly deploy` from a laptop does the same.
- **Public build values** (Supabase URL and publishable key) are `[build.args]` in `fly.toml`, because Next.js inlines `NEXT_PUBLIC_*` at build time.
- **Secrets** are set once on the Fly app, never committed:
  ```bash
  fly secrets set -a mm-lecture-visit MAILJET_API_KEY=… MAILJET_SECRET_KEY=… CALENDAR_ORGANIZER_EMAIL=… CALENDAR_ORGANIZER_NAME=…
  ```
- **GitHub:** environment `production` (deployment branch `production` only) with secret `FLY_API_TOKEN` from `fly tokens create deploy -a mm-lecture-visit`.
- **Supabase Auth:** the Site URL and redirect URLs (Authentication → URL Configuration) must include the deployed address, or sign-in and password-reset emails point to the wrong host.

## Project Structure

```
src/
├── app/            # Next.js App Router pages & layouts
├── components/     # React components
│   └── ui/         # Reusable UI primitives
└── lib/            # Utilities & helpers
```

## Database

Supabase PostgreSQL with 11 tables covering universities, study programs, lectures, professors, outreach, and visit assignments. See `AGENTS.md` for the full schema reference.

## Related

- **[LMU Scraper](https://github.com/JulianJungnitz/lmu_scraper)** — scrapes LMU course catalog
- **[TUM Scraper](https://github.com/JulianJungnitz/tum_scraper)** — scrapes TUM Online for courses and lecturers
