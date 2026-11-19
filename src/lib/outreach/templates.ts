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
 * "(MGT001365, englisch)", nor a trailing "- Lecture" / "(Lecture)", nor catalogue details such as "(6 ECTS/mit Übungen)",
 * "(Lehramt Realschule, …)" or an all-caps abbreviation such as "(CAMPP)".
 */
export function cleanLectureTitle(title: string): string {
  return title
    .replace(/\s*\[[^\]]*\]\s*$/, '')
    .replace(/\s*\([^)]*[A-Z]{2,}\d{3,}[^)]*\)/g, '')
    .replace(/\s*-\s*(?:Lecture|Vorlesung|VL)\s*$/i, '')
    .replace(/\s*\((?:Lecture|Vorlesung)\)\s*$/i, '')
    .replace(/\s*\((?:[^)]*\bECTS\b[^)]*|Lehramt[^)]*|[A-ZÄÖÜ]{4,})\)\s*$/, '')
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
export function findUnfilled(raw: string): string | null {
  const text = attachmentsOf(raw).body
  const bracket = text.match(/\[[^\]\n]*[A-ZÄÖÜ]{4,}[^\]\n]*\]/)
  if (bracket) return bracket[0]
  const brace = text.match(/\{[a-z_]+\}/)
  return brace ? brace[0] : null
}

const ATTACH_RE = /^\[\[attach:\s*(.+?)\s*\]\]\s*$/gm

/**
 * Lines "[[attach: file name.pdf]]" in an email body name files the mail bridge attaches from
 * its local attachments folder. Returns the body without those lines and the file names.
 */
export function attachmentsOf(body: string): { body: string; files: string[] } {
  const files = [...body.matchAll(ATTACH_RE)].map(m => m[1])
  return { body: files.length ? body.replace(ATTACH_RE, '').replace(/\n{3,}/g, '\n\n').trim() : body, files }
}

const BOLD_RE = /\*\*([^*\n]+)\*\*/g

/** Templates may mark text as bold with **…**; the plain-text part of an email drops the marks. */
export function plainText(body: string): string {
  return body.replace(BOLD_RE, '$1')
}

/** The HTML part of an email: paragraphs, line breaks and **bold** from the template text. */
export function htmlBody(body: string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const paragraphs = body.trim().split(/\n{2,}/)
    .map(p => `<p style="margin:0 0 1em">${escape(p).replace(BOLD_RE, '<strong>$1</strong>').replace(/\n/g, '<br>')}</p>`)
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">${paragraphs.join('')}</div>`
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
