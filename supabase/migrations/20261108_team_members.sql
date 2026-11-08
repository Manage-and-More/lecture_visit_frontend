-- The current visit team: only these people appear in the calendar, automatic scheduling and
-- visit teams. Matched to profiles by email, so someone can be added before they first sign in.
-- Former members keep their accounts but are no longer listed. Rows are added by an admin in
-- the SQL editor (names and addresses don't belong in this public repository).
begin;

create table public.team_members (
  email text primary key check (email = lower(email)),
  name text not null,
  generation smallint,
  created_at timestamptz not null default now()
);

alter table public.team_members enable row level security;

create policy "Members read the team" on public.team_members
  for select to authenticated using (true);
create policy "Admins manage the team" on public.team_members
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

commit;
