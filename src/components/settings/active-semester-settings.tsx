'use client'

import { useState, useTransition } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { updateActiveSemester } from '@/app/actions/settings'
import { useToast } from '@/hooks/use-toast'

const SEMESTERS = [
  'SoSe 2026', 'WiSe 2026/27', 'SoSe 2027', 'WiSe 2027/28',
  'SoSe 2028', 'WiSe 2028/29', 'SoSe 2029', 'WiSe 2029/30',
  'SoSe 2030', 'WiSe 2030/31'
]

interface ActiveSemesterSettingsProps {
  activeSemester: string
}

export function ActiveSemesterSettings({ activeSemester }: ActiveSemesterSettingsProps) {
  const [semester, setSemester] = useState(activeSemester)
  const [isPending, startTransition] = useTransition()
  const { toast } = useToast()

  const handleChange = (value: string) => {
    setSemester(value)

    startTransition(async () => {
      try {
        await updateActiveSemester(value)
        toast({
          title: 'Active semester updated',
          description: `Active semester changed to ${value}.`,
        })
      } catch (error) {
        setSemester(activeSemester)
        toast({
          title: 'Error',
          description: 'Failed to update active semester. Please try again.',
          variant: 'destructive',
        })
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active Semester</CardTitle>
        <CardDescription>
          Select the semester for campaign planning and outreach
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <Label htmlFor="active-semester">Semester</Label>
          <Select value={semester} onValueChange={handleChange} disabled={isPending}>
            <SelectTrigger id="active-semester">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEMESTERS.map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            Outreach, the calendar and visit planning use this semester.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
