import type { MailSettings } from '@/types/database'

type ProfessorName = {
  title: string | null
  first_name: string | null
  last_name: string | null
}

/**
 * Gender-neutral salutation name for an English email: "Professor Müller", "Dr. Müller",
 * or the full name. Degree suffixes such as "rer. nat." or "M.Sc." are left out.
 */
export function salutationName(p: ProfessorName): string {
  const last = (p.last_name ?? '').trim()
  const first = (p.first_name ?? '').trim()
  const title = p.title ?? ''
  if (last && /prof/i.test(title)) return `Professor ${last}`
  if (last && /\bdr\b|dr\./i.test(title)) return `Dr. ${last}`
  return [first, last].filter(Boolean).join(' ') || 'Sir or Madam'
}

/**
 * Lecture title as a lecturer would say it: without TUM module codes such as "[MA0003]" or
 * "(MGT001365, englisch)" at the end.
 */
export function cleanLectureTitle(title: string): string {
  return title
    .replace(/\s*\[[^\]]*\]\s*$/, '')
    .replace(/\s*\([^)]*[A-Z]{2,}\d{3,}[^)]*\)\s*$/, '')
    .trim() || title
}

/** "your lecture “X”" or "one of your lectures (“A” or “B”)". */
export function lecturePhrase(titles: string[]): string {
  const quoted = titles.map(t => `“${cleanLectureTitle(t)}”`)
  if (quoted.length === 0) return 'one of your lectures'
  if (quoted.length === 1) return `your lecture ${quoted[0]}`
  const list = quoted.length === 2
    ? `${quoted[0]} or ${quoted[1]}`
    : `${quoted.slice(0, -1).join(', ')} or ${quoted[quoted.length - 1]}`
  return `one of your lectures (${list})`
}

/** The test-mode marker the bridge puts in front of a subject ("[TEST an a@b.de] "). */
const TEST_PREFIX_RE = /\[TEST an [^\]]*\]\s*/g

/**
 * Subject for an answer in a thread: "Re: " once, without the test-mode marker, so an answer
 * to a test email doesn't carry the marker into the next email (where it would also look like
 * an unfilled placeholder).
 */
export function replySubject(subject: string): string {
  const clean = subject.replace(TEST_PREFIX_RE, '').replace(/^(\s*(re|aw|antw)\s*:\s*)+/i, '').trim()
  return `Re: ${clean}`
}

/** Replaces {key} placeholders; unknown keys stay visible so they're caught before sending. */
export function render(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-z_]+)\}/g, (match, key: string) => values[key] ?? match)
}

/**
 * Text a person still has to write ("[EIN SATZ …]") or a placeholder that wasn't filled.
 * Emails containing either are never sent.
 */
export function findUnfilled(text: string): string | null {
  const bracket = text.match(/\[[^\]\n]*[A-ZÄÖÜ]{4,}[^\]\n]*\]/)
  if (bracket) return bracket[0]
  const brace = text.match(/\{[a-z_]+\}/)
  return brace ? brace[0] : null
}

export type TemplateKind = 'request' | 'followup' | 'ack_yes' | 'ack_no' | 'confirmation'

export function templateFor(settings: MailSettings, kind: TemplateKind): string {
  switch (kind) {
    case 'request': return settings.template_request
    case 'followup': return settings.template_followup
    case 'ack_yes': return settings.template_ack_yes
    case 'ack_no': return settings.template_ack_no
    case 'confirmation': return settings.template_confirmation
  }
}
