'use client'

import { useState, useTransition } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { updateMailSettings } from '@/app/actions/outreach'
import { findUnfilled } from '@/lib/outreach/templates'
import type { MailSettings } from '@/types/database'

const FIELDS = [
  { key: 'template_request', label: 'First email', hint: '{salutation_name}, {sender_name}, {lecture_phrase}, {lecture_list}' },
  { key: 'template_followup', label: 'Reminder', hint: 'also {original_message}' },
  { key: 'template_ack_yes', label: 'Thank-you after a yes', hint: '{salutation_name}, {sender_name}' },
  { key: 'template_ack_no', label: 'Thank-you after a no', hint: '{salutation_name}, {sender_name}' },
  { key: 'template_confirmation', label: 'Date confirmation', hint: 'also {visit_date}, {visit_time}, {lecture_title}' },
] as const

type TemplateKey = (typeof FIELDS)[number]['key']

export function TemplateEditor({ settings }: { settings: MailSettings }) {
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [senderName, setSenderName] = useState(settings.sender_name)
  const [subject, setSubject] = useState(settings.subject_request)
  const [texts, setTexts] = useState<Record<TemplateKey, string>>(() =>
    Object.fromEntries(FIELDS.map(f => [f.key, settings[f.key]])) as Record<TemplateKey, string>)

  // Only text a person still has to write blocks sending; known {placeholders} are fine here
  const unfilled = (text: string) => {
    const found = findUnfilled(text)
    return found?.startsWith('[') ? found : null
  }

  const save = () => {
    startTransition(async () => {
      try {
        await updateMailSettings({ sender_name: senderName, subject_request: subject, ...texts })
        toast({ title: 'Templates saved' })
      } catch (error) {
        toast({ title: 'Not saved', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' })
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email texts</CardTitle>
        <CardDescription>
          Text in [CAPITALS IN BRACKETS] still has to be written: emails containing it aren&apos;t sent.
          Queued emails use the latest version when they go out.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="sender-name">Signed as</Label>
            <Input id="sender-name" value={senderName} onChange={e => setSenderName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="subject">Subject of the first email</Label>
            <Input id="subject" value={subject} onChange={e => setSubject(e.target.value)} />
          </div>
        </div>
        {FIELDS.map(field => {
          const missing = unfilled(texts[field.key])
          return (
            <div key={field.key} className="space-y-1">
              <Label htmlFor={field.key}>{field.label}</Label>
              <Textarea
                id={field.key}
                rows={field.key === 'template_request' ? 12 : 6}
                value={texts[field.key]}
                onChange={e => setTexts(prev => ({ ...prev, [field.key]: e.target.value }))}
                className="font-mono text-[13px]"
              />
              <p className="text-xs text-muted-foreground">Placeholders: {field.hint}</p>
              {missing && <p className="text-xs text-amber-700">Still to write: {missing}</p>}
            </div>
          )
        })}
        <Button onClick={save} disabled={isPending}>Save texts</Button>
      </CardContent>
    </Card>
  )
}
