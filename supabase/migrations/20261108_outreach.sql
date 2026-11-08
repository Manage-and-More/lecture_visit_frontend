-- Automatic outreach: one email thread per lecturer per semester, the lectures it covers,
-- every message sent or received, the visits that come out of it, an opt-out list and the
-- mail settings. The Apps Script mail bridge writes with the service role; people write
-- through the app, and RLS limits every table here to admins (visits are readable by all
-- signed-in members).
begin;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false)
$$;

-- Single row (id is always true)
create table public.mail_settings (
  id boolean primary key default true check (id),
  mode text not null default 'off' check (mode in ('off', 'test', 'live')),
  daily_cap int not null default 30 check (daily_cap between 0 and 1000),
  per_run_cap int not null default 5 check (per_run_cap between 1 and 50),
  followup_after_days int not null default 7 check (followup_after_days between 1 and 60),
  max_followups int not null default 1 check (max_followups between 0 and 3),
  auto_ack_yes boolean not null default true,
  auto_ack_no boolean not null default true,
  lecture_type_filter text not null default 'Vorlesung',
  sender_name text not null default 'Nick Dienemann',
  sender_email text not null default 'nick.dienemann@manageandmore.de',
  subject_request text not null default 'Kurze Vorstellung von Manage & More in Ihrer Vorlesung?',
  template_request text not null default
'Guten Tag {salutation_name},

mein Name ist {sender_name}, ich engagiere mich bei Manage & More. [EIN BIS ZWEI SÄTZE: WAS MANAGE & MORE IST UND WARUM ES FÜR STUDIERENDE INTERESSANT IST]

Wir würden Manage & More gerne {lecture_phrase} kurz vorstellen. Dafür bräuchten wir nur etwa 5 Minuten zu Beginn oder am Ende einer Sitzung, an einem Termin, der Ihnen passt.

Wäre das für Sie in Ordnung? Dann melden wir uns mit einem konkreten Terminvorschlag.

Vielen Dank und viele Grüße
{sender_name}
Manage & More',
  template_followup text not null default
'Guten Tag {salutation_name},

ich wollte kurz an meine Nachricht von letzter Woche erinnern: Wir würden Manage & More gerne {lecture_phrase} in etwa 5 Minuten vorstellen. Wäre das für Sie in Ordnung?

Viele Grüße
{sender_name}

----- Ursprüngliche Nachricht -----
{original_message}',
  template_ack_yes text not null default
'Guten Tag {salutation_name},

vielen Dank für Ihre positive Rückmeldung! Wir melden uns in Kürze mit einem konkreten Terminvorschlag.

Viele Grüße
{sender_name}',
  template_ack_no text not null default
'Guten Tag {salutation_name},

vielen Dank für Ihre Rückmeldung, das ist völlig in Ordnung.

Viele Grüße
{sender_name}',
  template_confirmation text not null default
'Guten Tag {salutation_name},

wie besprochen kommen wir am {visit_date} um {visit_time} in Ihre Vorlesung „{lecture_title}“ und stellen Manage & More in etwa 5 Minuten vor. Falls sich etwas ändert, geben Sie uns gerne kurz Bescheid.

Viele Grüße
{sender_name}',
  last_bridge_at timestamptz,
  last_bridge_error text,
  bridge_audience text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
insert into public.mail_settings (id) values (true);

create table public.professor_outreach (
  id uuid primary key default gen_random_uuid(),
  professor_id uuid not null references public.professors(id) on delete cascade,
  semester public.semester_type not null,
  status text not null default 'queued' check (status in (
    'queued', 'awaiting_reply', 'interested', 'declined', 'needs_attention',
    'scheduled', 'do_not_contact', 'failed', 'cancelled')),
  to_email text not null,
  cc_emails text[] not null default '{}',
  ai_summary text,
  attention_reason text,
  first_sent_at timestamptz,
  last_inbound_at timestamptz,
  followups_sent int not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (professor_id, semester)
);
create index professor_outreach_status_idx on public.professor_outreach (semester, status);

create table public.outreach_lectures (
  outreach_id uuid not null references public.professor_outreach(id) on delete cascade,
  lecture_id uuid not null references public.lectures(id) on delete cascade,
  position int not null default 0,
  response text not null default 'pending' check (response in ('pending', 'yes', 'no')),
  primary key (outreach_id, lecture_id)
);
create index outreach_lectures_lecture_idx on public.outreach_lectures (lecture_id);

create table public.email_messages (
  id uuid primary key default gen_random_uuid(),
  outreach_id uuid not null references public.professor_outreach(id) on delete cascade,
  direction text not null check (direction in ('outbound', 'inbound')),
  kind text not null check (kind in (
    'request', 'followup', 'ack_yes', 'ack_no', 'confirmation', 'manual', 'reply', 'bounce')),
  status text not null check (status in ('queued', 'sending', 'sent', 'failed', 'cancelled', 'received')),
  from_email text,
  to_emails text[] not null default '{}',
  cc_emails text[] not null default '{}',
  subject text not null default '',
  -- Outbound request/follow-up bodies stay empty until sending, so template edits still apply
  body text not null default '',
  -- Outbound: answer this inbound Gmail message in its thread
  reply_to_gmail_message_id text,
  gmail_message_id text unique,
  gmail_thread_id text,
  error text,
  classification jsonb,
  classified_at timestamptz,
  processing_error text,
  attempts int not null default 0,
  queued_at timestamptz,
  lease_at timestamptz,
  sent_at timestamptz,
  received_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index email_messages_outbox_idx on public.email_messages (status, queued_at) where status in ('queued', 'sending');
create index email_messages_thread_idx on public.email_messages (gmail_thread_id);
create index email_messages_outreach_idx on public.email_messages (outreach_id, created_at);
create index email_messages_unclassified_idx on public.email_messages (received_at)
  where direction = 'inbound' and kind = 'reply' and classified_at is null;

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  lecture_id uuid not null references public.lectures(id) on delete cascade,
  outreach_id uuid references public.professor_outreach(id) on delete set null,
  semester public.semester_type not null,
  scheduled_for timestamptz,
  duration_minutes int not null default 10,
  location text,
  status text not null default 'planned' check (status in ('planned', 'confirmed', 'done', 'cancelled')),
  assignee_ids uuid[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index visits_semester_idx on public.visits (semester, scheduled_for);

-- Addresses that asked not to be contacted again (lowercase)
create table public.do_not_contact (
  email text primary key check (email = lower(email)),
  professor_id uuid references public.professors(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

alter table public.mail_settings enable row level security;
alter table public.professor_outreach enable row level security;
alter table public.outreach_lectures enable row level security;
alter table public.email_messages enable row level security;
alter table public.visits enable row level security;
alter table public.do_not_contact enable row level security;

create policy "Admins manage mail settings" on public.mail_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage outreach" on public.professor_outreach
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage outreach lectures" on public.outreach_lectures
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage email messages" on public.email_messages
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage do-not-contact list" on public.do_not_contact
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Members read visits" on public.visits
  for select to authenticated using (true);
create policy "Admins manage visits" on public.visits
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

commit;
