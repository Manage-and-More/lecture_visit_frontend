-- Screening lectures by expected audience.
-- - lecture_study_programs.recommended_semester: the semester a program recommends the lecture in
--   (TUM curricula; LMU where the lecture list says so).
-- - study_programs.student_count: students in the program, where known (for weighting).
-- - lecture_scores: an estimated-audience score per lecture with its reasons, recomputed by
--   scripts/screening/score.ts after imports. Readable by signed-in members; written with the
--   service role.
begin;

-- recommended_semester already existed in production (an earlier import); keep it if present
alter table public.lecture_study_programs
  add column if not exists recommended_semester smallint check (recommended_semester between 1 and 20);

alter table public.study_programs
  add column student_count integer check (student_count >= 0);

create table public.lecture_scores (
  lecture_id uuid primary key references public.lectures(id) on delete cascade,
  semester public.semester_type not null,
  score numeric not null,
  reasons text[] not null default '{}',
  program_count integer not null default 0,
  mandatory_count integer not null default 0,
  has_email boolean not null default false,
  in_lecture_hall boolean not null default false,
  computed_at timestamptz not null default now()
);
create index lecture_scores_rank_idx on public.lecture_scores (semester, score desc);

alter table public.lecture_scores enable row level security;
create policy "Members read lecture scores" on public.lecture_scores
  for select to authenticated using (true);

commit;
