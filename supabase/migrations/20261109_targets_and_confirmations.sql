-- Target lectures: one shared list for everyone, chosen on the Lectures page. Outreach and
-- the calendar's "Target lectures" use only these. Everyone signed in reads; admins edit.
-- Availability confirmations: a team member commits their availability; only committed
-- availability counts for matching and scheduling. Any change to their entries clears it.
begin;

create table public.target_lectures (
  lecture_id uuid primary key references public.lectures(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now()
);

alter table public.target_lectures enable row level security;
create policy "Members read target lectures" on public.target_lectures
  for select to authenticated using (true);
create policy "Admins manage target lectures" on public.target_lectures
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create table public.availability_confirmations (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  confirmed_at timestamptz not null default now()
);

alter table public.availability_confirmations enable row level security;
create policy "Members read confirmations" on public.availability_confirmations
  for select to authenticated using (true);
create policy "Members confirm their own availability" on public.availability_confirmations
  for all to authenticated
  using (profile_id = auth.uid() or public.is_admin())
  with check (profile_id = auth.uid() or public.is_admin());

commit;
