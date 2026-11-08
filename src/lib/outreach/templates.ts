import type { MailSettings } from '@/types/database'

type ProfessorName = {
  title: string | null
  first_name: string | null
  last_name: string | null
}

/**
 * Neutral salutation name: "Prof. Dr. Müller", "Dr. Müller", or the full name.
 * Degree suffixes such as "rer. nat." or "M.Sc." are left out, as in a normal letter.
 */
export function salutationName(p: ProfessorName): string {
  const last = (p.last_name ?? '').trim()
  const first = (p.first_name ?? '').trim()
  const title = p.title ?? ''
  const hasProf = /prof/i.test(title)
  const hasDr = /\bdr\b|dr\./i.test(title)
  if (last && hasProf) return `${hasDr ? 'Prof. Dr.' : 'Prof.'} ${last}`
  if (last && hasDr) return `Dr. ${last}`
  return [first, last].filter(Boolean).join(' ') || 'Damen und Herren'
}

/** "in Ihrer Vorlesung „X“" or "in einer Ihrer Vorlesungen („A“ oder „B“)". */
export function lecturePhrase(titles: string[]): string {
  const quoted = titles.map(t => `„${t}“`)
  if (quoted.length === 0) return 'in Ihrer Vorlesung'
  if (quoted.length === 1) return `in Ihrer Vorlesung ${quoted[0]}`
  const list = quoted.length === 2
    ? `${quoted[0]} oder ${quoted[1]}`
    : `${quoted.slice(0, -1).join(', ')} oder ${quoted[quoted.length - 1]}`
  return `in einer Ihrer Vorlesungen (${list})`
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
