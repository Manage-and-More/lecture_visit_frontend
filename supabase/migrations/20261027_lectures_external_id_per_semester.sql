-- Universities reuse lecture numbers across semesters, so a lecture is unique per
-- (university, external_id, semester), not per (university, external_id).
-- Without this, importing a new semester collides with the previous semester's rows.
-- Replaces two identical unique indexes on (university_id, external_id).
-- Applied to supabase-chestnut-canvas on 2026-10-27 via the SQL editor.
begin;
drop index public.idx_lectures_external_id;
drop index public.idx_lectures_university_external;
create unique index idx_lectures_university_external_semester
  on public.lectures (university_id, external_id, semester)
  where external_id is not null;
commit;
