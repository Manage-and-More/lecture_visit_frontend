-- Members' weekly free time, used to plan lecture visits. Each member edits their own rows;
-- everyone signed in can read them so admins (and the scheduler) can match visits to people.
begin;

create table public.member_availability (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7), -- 1 = Monday, 7 = Sunday
  start_time time not null,
  end_time time not null check (end_time > start_time),
  created_at timestamptz not null default now()
);
create index member_availability_profile_idx on public.member_availability (profile_id);

alter table public.member_availability enable row level security;

create policy "Members read availability" on public.member_availability
  for select to authenticated using (true);
create policy "Members manage their own availability" on public.member_availability
  for all to authenticated
  using (profile_id = auth.uid() or public.is_admin())
  with check (profile_id = auth.uid() or public.is_admin());

commit;
