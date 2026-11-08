# AGENTS.md — Lecture Visit

## Project Vision

**Lecture Visit** is an internal coordination tool for a student club to plan and manage **lecture visit campaigns** — short promotional appearances during the first or second lecture of the semester at Munich universities. The initial focus is on **LMU** (Ludwig-Maximilians-Universität München) and **TUM** (Technische Universität München), with architecture designed to support additional universities over time.

The core idea: before each semester, the club needs to identify which lectures to visit, contact the right professors (without emailing the same person twice), and coordinate who visits which lecture. This app is the command center for that process.

## Problem Statement

Coordinating lecture visits across multiple universities is painful without tooling:

- **Scattered data** — Lecture info lives in PDFs, portals, and websites with different formats per university
- **Professor deduplication** — A professor may teach multiple lectures; emailing them once (not per lecture) requires tracking at the professor level
- **Filtering by relevance** — Not every lecture is worth visiting; the club needs to filter by study program, lecture size, type (Vorlesung vs Seminar), and timing
- **Outreach tracking** — Who has been contacted? Who said yes/no? Which lectures are confirmed for a visit?
- **Email drafting** — Writing personalized outreach emails to professors is repetitive and could be partially automated

## Core Domain Model

```
University (LMU, TUM, ...)
  └── Study Program (Physics BSc, Informatik MSc, ...)
        └── Lecture / Course
              ├── Title, Type (Vorlesung, Seminar, Übung, ...)
              ├── Schedule (day, time, location)
              ├── Semester (WiSe 2025/26, SoSe 2026, ...)
              └── Professor(s) / Lecturer(s)
                    └── Outreach Status (not contacted, emailed, confirmed, declined)
```

**Key relationships:**

- A university has many study programs
- A study program has many lectures
- A lecture belongs to one or more study programs (cross-listed)
- A lecture is taught by one or more professors
- A professor may teach at one university but across multiple programs
- **A professor is contacted ONCE, regardless of how many lectures they teach** — this is a core constraint

## Data Sources (Scrapers — Work in Progress)

Scrapers exist but are **not finalized**. The data in the scraper folders is preliminary and will be updated. Do not rely on current CSV contents or field names for schema design — treat them as directional only.

### LMU Scraper (`lmu_scraper/`)

- Targets the LMU Veranstaltungsverzeichnis (course catalog) and study program listings
- Will produce: study programs, lectures, schedule info, professor names

### TUM Scraper (`tum_scraper/`)

- Playwright-based scraper targeting TUM Online for lecturer and course data
- Will produce: similar structure to LMU (programs, lectures, professors)

## Tech Stack

- **Frontend**: To be built (greenfield) — likely Next.js / React
- **Backend / Database**: Supabase (PostgreSQL) — schema deployed via 5 migrations
- **Data Pipeline**: Python scrapers (LMU + TUM) — work in progress, not yet finalized
- **Hosting**: Fly.io, app `mm-lecture-visit` (`iad`). Deploys from the `production` branch; see README → Deployment

## Feature Roadmap

### Phase 1 — Foundation (Core Infrastructure)

- [ ] Design and create Supabase database schema (universities, programs, lectures, professors, outreach status)
- [ ] Import scraped LMU and TUM data into Supabase
- [ ] Build frontend scaffold (Next.js)
- [ ] Browse & filter: universities → study programs → lectures → professors
- [ ] Professor-level deduplication (see all lectures per professor, across programs)

### Phase 2 — Outreach Workflow

- [ ] Professor outreach status tracking (not contacted / emailed / confirmed / declined)
- [ ] Filter professors by: not yet contacted, study program, lecture type, university
- [ ] Lecture visit assignment (who from the club visits which lecture)
- [ ] Dashboard: semester overview (contacted, confirmed, pending, visited)

### Phase 3 — Email & Automation

- [ ] Email draft generation (first-pass template with professor name, lecture, program context)
- [ ] Email template management (different templates per university)
- [ ] Bulk outreach support (select multiple professors, generate drafts)
- [ ] History: outreach log per professor across semesters

### Phase 4 — Growth

- [ ] Add more universities beyond LMU and TUM
- [ ] Automated scraper pipeline (periodic data refresh per semester)
- [ ] Calendar view for visit scheduling (who goes where, when)
- [ ] Analytics: which programs/lectures yield the best recruitment results

## Architecture Decisions

Some decisions are resolved; others are still pending.

1. **Frontend framework** — Next.js App Router vs Pages Router vs other _(pending)_
2. **Styling approach** — Tailwind, CSS Modules, shadcn/ui, etc. _(pending)_
3. **Data import strategy** — One-time script vs ongoing sync pipeline _(pending)_
4. **Auth model** — **RESOLVED**: Supabase Auth with `profiles` table. Club-internal only.
5. **Schema design** — **RESOLVED**: Professor as first-class entity scoped per university. Semester-based outreach tracking via `professor_outreach`. See Database Schema below.

## Database Schema

11 tables in Supabase PostgreSQL. Migrations: `create_initial_schema`, `add_lecture_schedules_and_refinements`, `add_professor_gender`, `remove_duplicate_schedule_location_from_lectures`, `replace_campaigns_with_semester_enum_and_outreach`.

### Tables

| Table                    | Purpose                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `universities`           | LMU, TUM, and future institutions                                                             |
| `faculties`              | Faculty groupings within a university (nullable for TUM programs)                             |
| `study_programs`         | Degree programs (BSc Physics, MSc Informatik, etc.)                                           |
| `lectures`               | Individual courses — type, semester (enum), notes, starred flag                               |
| `professors`             | First-class entity scoped per university — name, email, gender, external_id for scraper dedup |
| `lecture_professors`     | Many-to-many: which professors teach which lectures                                           |
| `lecture_study_programs` | Many-to-many: which lectures belong to which programs (cross-listing)                         |
| `profiles`               | Club member profiles (mirrors auth.users id) — display_name, is_admin boolean                 |
| `professor_outreach`     | Outreach status per professor per semester (not_contacted → emailed → confirmed/declined)     |
| `visit_assignments`      | Who from the club visits which lecture — semester, scheduled_for timestamp                    |
| `lecture_schedules`      | Multiple schedule slots per lecture (day/time/location) with FK to lectures                   |

### Key Design Decisions

- **Professor dedup**: One professor row per university. Contacted once per semester regardless of how many lectures they teach.
- **Semester model**: `semester_type` enum (e.g. `WiSe 2026/27`, `SoSe 2026`) used on `lectures`, `professor_outreach`, and `visit_assignments`. New semesters added via `ALTER TYPE semester_type ADD VALUE`.
- **Outreach model**: `professor_outreach` table keyed by `(professor_id, semester)`. Replaces the old 3-table campaigns system. Stores outreach status, which lectures were mentioned (uuid array), who contacted them, and when.
- **Outreach statuses**: `not_contacted`, `emailed`, `confirmed`, `declined`
- **Professor gender**: `professor_gender` enum (`male`, `female`, `other`, `unknown`) for email salutations (Herr/Frau Prof.)
- **Source tracking**: `external_id` + `source` on professors, `external_id` on lectures — enables clean scraper re-imports without duplicates
- **Profiles trigger**: `handle_new_user()` auto-creates a profile row when a club member signs up via Supabase Auth
- **Schedule format**: `lecture_schedules` stores structured schedule data. `day_time` uses format "MO 10:00 - 12:00"; `frequency` uses "WEEKLY 13.10.2025 - 06.02.2026" or "SINGLE 10.01.2026". A `location` text field and `room_url` link are also stored.
- **Admin roles**: `profiles.is_admin` boolean controls club member role management
- **Visit scheduling**: `visit_assignments.scheduled_for` timestamp records when the visit is planned; the `status` field tracks whether the visit actually happened

## Conventions

- Database: Supabase (PostgreSQL), managed via MCP tooling
  supabase-chestnut-canvas
  https://wgdzikstvulyrkuozemb.supabase.co
- Schema is deployed — 11 tables via migrations `create_initial_schema`, `add_lecture_schedules_and_refinements`, `add_professor_gender`, `remove_duplicate_schedule_location_from_lectures`, `replace_campaigns_with_semester_enum_and_outreach`, `trim_semester_enum_start_from_sose_2026`
- Scraped data is the source of truth for initial content
- Frontend repo is at `frontend/`, scrapers are sibling directories
