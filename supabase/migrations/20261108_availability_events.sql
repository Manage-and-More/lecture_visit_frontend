-- Availability as calendar entries: a time on a specific day, optionally repeating every week
-- (on that weekday, from that day until repeat_until or open-ended). Replaces the weekday-only
-- format; the table was still empty when this ran.
begin;

alter table public.member_availability drop column weekday;
alter table public.member_availability
  add column date date not null,
  add column repeats_weekly boolean not null default false,
  add column repeat_until date,
  add constraint member_availability_repeat_until_check check (repeat_until is null or repeat_until >= date);

create index member_availability_date_idx on public.member_availability (date);

commit;
