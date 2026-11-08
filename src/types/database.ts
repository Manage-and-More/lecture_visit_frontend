export type University = {
  id: string
  name: string
  full_name: string | null
  website: string | null
}

export type Faculty = {
  id: string
  university_id: string
  name: string
}

export type StudyProgram = {
  id: string
  university_id: string
  faculty_id: string | null
  name: string
  degree_type: string
  category: string | null
  studienordnung_url: string | null
  url: string | null
  is_starred: boolean | null
}

export type SemesterType =
  | 'SoSe 2026' | 'WiSe 2026/27' | 'SoSe 2027' | 'WiSe 2027/28'
  | 'SoSe 2028' | 'WiSe 2028/29' | 'SoSe 2029' | 'WiSe 2029/30'
  | 'SoSe 2030' | 'WiSe 2030/31'

export type OutreachStatus = 'not_contacted' | 'emailed' | 'confirmed' | 'declined' | 'done'

export type Lecture = {
  id: string
  university_id: string
  title: string
  lecture_type: string | null
  semester: SemesterType | null
  description: string | null
  source_url: string | null
  external_id: string | null
  is_starred: boolean | null
  notes: string | null
  owner: string | null
  outreach_status: OutreachStatus | null
  estimated_attendees: number | null
  ics_uid: string | null
  visit_assigned_to: string | null
  visit_scheduled_for: string | null
  contacted_at: string | null
}

export type ProfessorGender = 'male' | 'female' | 'other' | 'unknown'

export type Professor = {
  id: string
  university_id: string
  first_name: string
  last_name: string | null
  email: string | null
  title: string | null
  gender: ProfessorGender
  department: string | null
  source_url: string | null
  notes: string | null
}

export type LectureSchedule = {
  id: string
  lecture_id: string
  day_time: string | null
  frequency: string | null
  location: string | null
  room_url: string | null
  date_range: string | null
}

// Junction table types
export type LectureProfessor = {
  lecture_id: string
  professor_id: string
}

export type LectureStudyProgram = {
  lecture_id: string
  study_program_id: string
  lecture_obligation: string | null
}

export type LectureWithObligation = Lecture & {
  lecture_obligation: string | null
}

// Composite types for common query results
export type StudyProgramWithUniversity = StudyProgram & {
  university: University
}

export type StudyProgramWithDetails = StudyProgram & {
  university: University
  faculty: Faculty | null
}

export type LectureWithDetails = Lecture & {
  university: University
  professors: Professor[]
  schedules: LectureSchedule[]
  study_programs: StudyProgram[]
}

export type ProfessorWithUniversity = Professor & {
  university: University
}

export type Profile = {
  id: string
  display_name: string | null
  email: string | null
  is_admin: boolean | null
  created_at: string
  updated_at: string
}

export type LectureWithOwnerProfile = Lecture & {
  owner_profile: Profile | null
}

// Parameter type for settings
export type Parameter = {
  key: string
  value: string | null
}

// Outreach (supabase/migrations/20261108_outreach.sql)
export type MailMode = 'off' | 'test' | 'live'

export type MailSettings = {
  id: boolean
  mode: MailMode
  daily_cap: number
  per_run_cap: number
  followup_after_days: number
  max_followups: number
  auto_ack_yes: boolean
  auto_ack_no: boolean
  lecture_type_filter: string
  sender_name: string
  sender_email: string
  subject_request: string
  template_request: string
  template_followup: string
  template_ack_yes: string
  template_ack_no: string
  template_confirmation: string
  last_bridge_at: string | null
  last_bridge_error: string | null
  bridge_audience: string | null
  updated_at: string
  updated_by: string | null
}

export type OutreachThreadStatus =
  | 'queued' | 'awaiting_reply' | 'interested' | 'declined' | 'needs_attention'
  | 'scheduled' | 'do_not_contact' | 'failed' | 'cancelled'

export type ProfessorOutreach = {
  id: string
  professor_id: string
  semester: SemesterType
  status: OutreachThreadStatus
  to_email: string
  cc_emails: string[]
  ai_summary: string | null
  attention_reason: string | null
  first_sent_at: string | null
  last_inbound_at: string | null
  followups_sent: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export type OutreachLecture = {
  outreach_id: string
  lecture_id: string
  position: number
  response: 'pending' | 'yes' | 'no'
}

export type EmailKind = 'request' | 'followup' | 'ack_yes' | 'ack_no' | 'confirmation' | 'manual' | 'reply' | 'bounce'
export type EmailStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled' | 'received'

export type EmailMessage = {
  id: string
  outreach_id: string
  direction: 'outbound' | 'inbound'
  kind: EmailKind
  status: EmailStatus
  from_email: string | null
  to_emails: string[]
  cc_emails: string[]
  subject: string
  body: string
  reply_to_gmail_message_id: string | null
  gmail_message_id: string | null
  gmail_thread_id: string | null
  error: string | null
  classification: ReplyClassification | null
  classified_at: string | null
  processing_error: string | null
  attempts: number
  queued_at: string | null
  lease_at: string | null
  sent_at: string | null
  received_at: string | null
  created_by: string | null
  created_at: string
}

export type ReplyCategory = 'yes' | 'no' | 'question' | 'redirect' | 'out_of_office' | 'do_not_contact' | 'other'

export type ReplyClassification = {
  category: ReplyCategory
  confidence: 'high' | 'medium' | 'low'
  summary: string
  lecture_decisions: { lecture_number: number; decision: 'yes' | 'no' | 'unclear' }[]
  conditions: string | null
  mentioned_dates: string[]
  redirect_contact: string | null
  needs_human: boolean
  reason_for_human: string | null
}

// Visit planning (supabase/migrations/20261108_member_availability.sql)
export type VisitStatus = 'planned' | 'confirmed' | 'done' | 'cancelled'

export type Visit = {
  id: string
  lecture_id: string
  outreach_id: string | null
  semester: SemesterType
  scheduled_for: string | null
  duration_minutes: number
  location: string | null
  status: VisitStatus
  assignee_ids: string[]
  notes: string | null
  created_at: string
  updated_at: string
}

export type MemberAvailability = {
  id: string
  profile_id: string
  weekday: number // 1 = Monday, 7 = Sunday
  start_time: string // "HH:MM:SS"
  end_time: string
  created_at: string
}
