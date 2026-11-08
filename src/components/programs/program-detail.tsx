'use client'
import { useState, useEffect } from 'react'
import { ExternalLink, FileText, BookOpen, Plus, Loader2, X, ChevronRight } from 'lucide-react'
import { UniversityBadge } from '@/components/university-badge'
import { SearchInput } from '@/components/search-input'
import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { searchAllLectures, addLectureToProgram, removeLectureFromProgram, type LectureSearchResult } from '@/app/actions/programs'
import { StarToggle } from '@/components/star-toggle'
import type { StudyProgramWithDetails, LectureWithObligation } from '@/types/database'


interface ProgramDetailProps {
  program: StudyProgramWithDetails
  lectures: LectureWithObligation[]
}

export function ProgramDetail({ program, lectures }: ProgramDetailProps) {
  const [assignedLectures, setAssignedLectures] = useState(lectures)
  const [addSearch, setAddSearch] = useState('')
  const [searchResults, setSearchResults] = useState<LectureSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ Elective: true, Unknown: true })
  const [lectureTypeOnly, setLectureTypeOnly] = useState(true)
  const [removingId, setRemovingId] = useState<string | null>(null)

  useEffect(() => {
    const trimmed = addSearch.trim()
    const timer = setTimeout(async () => {
      if (!trimmed) {
        setSearchResults([])
        setIsSearching(false)
        return
      }
      setIsSearching(true)
      const results = await searchAllLectures(trimmed, assignedLectures.map(l => l.id), program.university.id)
      setSearchResults(results)
      setIsSearching(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [addSearch, assignedLectures, program.university.id])

  async function handleAdd(lecture: LectureSearchResult, obligation: string) {
    setAddingId(lecture.id)
    await addLectureToProgram(lecture.id, program.id, obligation)
    setAssignedLectures(prev => [...prev, { ...lecture, lecture_obligation: obligation }])
    setSearchResults(prev => prev.filter(l => l.id !== lecture.id))
    setAddingId(null)
  }

  async function handleRemove(lecture: LectureWithObligation) {
    setRemovingId(lecture.id)
    await removeLectureFromProgram(lecture.id, program.id)
    setAssignedLectures(prev => prev.filter(l => l.id !== lecture.id))
    setRemovingId(null)
  }

  return (
    <div className="flex gap-0 h-[calc(100vh-8rem)]">
      {/* Left panel: 60% */}
      <div className="flex flex-col w-[60%] border-r border-black/[0.06] pr-6">
        {/* Header */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1">
            <StarToggle id={program.id} type="program" initialStarred={!!program.is_starred} />
            <h1 className="text-xl font-semibold tracking-tight">{program.name}</h1>
            <UniversityBadge universityName={program.university.name} />
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">{program.degree_type}</Badge>
            {program.category && (
              <span className="text-xs text-muted-foreground">{program.category}</span>
            )}
            {program.faculty && (
              <span className="text-xs text-muted-foreground">· {program.faculty.name}</span>
            )}
          </div>
          {program.url && (
            <a
              href={program.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors w-fit"
            >
              <ExternalLink className="h-3 w-3" />
              External program page
            </a>
          )}
        </div>

        <Separator className="mb-3" />

        <div className="flex items-center gap-2 mb-3">
          <button
            type="button"
            onClick={() => setLectureTypeOnly(v => !v)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              lectureTypeOnly
                ? 'bg-foreground text-background border-foreground'
                : 'border-black/[0.12] text-muted-foreground hover:border-black/25 hover:text-foreground'
            }`}
          >
            Lectures only
          </button>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          {assignedLectures.length === 0 ? (
            <EmptyState
              title="No lectures assigned"
              description="Use the search below to add lectures to this program"
              icon={BookOpen}
            />
          ) : (
            <div className="space-y-6 pr-4">
              {([
                { key: 'starred', label: 'Starred', filter: (l: LectureWithObligation) => !!l.is_starred },
                { key: 'mandatory', label: 'Mandatory', filter: (l: LectureWithObligation) => l.lecture_obligation === 'mandatory' },
                { key: 'elective', label: 'Elective', filter: (l: LectureWithObligation) => l.lecture_obligation === 'elective' },
                { key: 'unknown', label: 'Unknown', filter: (l: LectureWithObligation) => l.lecture_obligation !== 'mandatory' && l.lecture_obligation !== 'elective' },
              ] as const).map(({ key, label, filter }) => {
                const group = assignedLectures.filter(l => {
                  if (lectureTypeOnly) {
                    const t = (l.lecture_type ?? '').toLowerCase()
                    if (!t.includes('lecture') && !t.includes('vorlesung')) return false
                  }
                  return filter(l)
                })
                if (group.length === 0) return null
                return (
                  <div key={key}>
                    <button
                      type="button"
                      onClick={() => setCollapsed(prev => ({ ...prev, [label]: !prev[label] }))}
                      className="flex items-center gap-2 mb-2 w-full text-left"
                    >
                      <ChevronRight className={`h-3 w-3 text-muted-foreground transition-transform ${collapsed[label] ? '' : 'rotate-90'}`} />
                      <span className="text-xs font-semibold uppercase tracking-wider text-foreground/70">{label}</span>
                      <span className="text-xs text-muted-foreground bg-black/[0.05] rounded-full px-1.5 py-0.5 leading-none">{group.length}</span>
                      <div className="flex-1 h-px bg-black/[0.06]" />
                    </button>
                    {!collapsed[label] && <div className="space-y-1">
                      {group.map(lecture => (
                        <div key={lecture.id} className="group flex items-center rounded-lg px-3 py-2.5 hover:bg-black/[0.03] transition-all duration-200">
                          <StarToggle id={lecture.id} type="lecture" initialStarred={!!lecture.is_starred} size="sm" />
                          <div className="flex-1 min-w-0 ml-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{lecture.title}</span>
                              {lecture.lecture_type && (
                                <Badge variant="outline" className="text-xs shrink-0">
                                  {lecture.lecture_type}
                                </Badge>
                              )}
                            </div>
                            {lecture.semester && (
                              <span className="text-xs text-muted-foreground">{lecture.semester}</span>
                            )}
                          </div>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <button
                                type="button"
                                disabled={removingId === lecture.id}
                                className="ml-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-black/[0.06] text-muted-foreground hover:text-foreground disabled:opacity-50"
                                aria-label="Remove lecture from program"
                              >
                                {removingId === lecture.id
                                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  : <X className="h-3.5 w-3.5" />
                                }
                              </button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remove lecture?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  &quot;{lecture.title}&quot; will be removed from this program. You can add it back at any time.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleRemove(lecture)}>
                                  Remove
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      ))}
                    </div>}
                  </div>
                )
              })}
            </div>
          )}
        </ScrollArea>

        <Separator className="my-4" />

        {/* Add lecture section */}
        <div className="flex-shrink-0">
          <div className="flex items-center gap-1.5 mb-3">
            <Plus className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Add a lecture to this program
            </span>
          </div>

          <SearchInput
            placeholder="Search all lectures…"
            value={addSearch}
            onChange={setAddSearch}
          />

          <div className="mt-2 rounded-lg border border-black/[0.06] overflow-hidden max-h-[220px] overflow-y-auto">
            {isSearching ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                <span className="text-xs">Searching…</span>
              </div>
            ) : addSearch.trim() === '' ? (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                Type to search all lectures
              </div>
            ) : searchResults.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                No lectures found
              </div>
            ) : (
              <div className="divide-y divide-black/[0.04]">
                {searchResults.map(lecture => (
                  <div
                    key={lecture.id}
                    className="flex items-center justify-between px-3 py-2.5 hover:bg-black/[0.02]"
                  >
                    <div className="min-w-0 mr-3">
                      <p className="text-sm font-medium truncate">{lecture.title}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <UniversityBadge universityName={lecture.university.name} />
                        {lecture.semester && (
                          <span className="text-xs text-muted-foreground">{lecture.semester}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {lecture.lecture_type && (
                        <Badge variant="outline" className="text-xs">
                          {lecture.lecture_type}
                        </Badge>
                      )}
                      {addingId === lecture.id ? (
                        <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" disabled>
                          <Loader2 className="h-3 w-3 animate-spin" />
                        </Button>
                      ) : (
                        <Select
                          value=""
                          onValueChange={(v) => handleAdd(lecture, v)}
                        >
                          <SelectTrigger className="h-7 w-auto gap-1 px-2.5 text-xs border rounded-md">
                            <Plus className="h-3 w-3" />
                            <span>Add</span>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="mandatory">Mandatory</SelectItem>
                            <SelectItem value="elective">Elective</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right panel: 40% — PDF viewer */}
      <div className="flex flex-col w-[40%] pl-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">Curriculum Document</h2>
          {program.studienordnung_url && (
            <Button variant="outline" size="sm" asChild>
              <a href={program.studienordnung_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                Open in new tab
              </a>
            </Button>
          )}
        </div>

        <div className="flex-1 rounded-xl border border-black/[0.06] overflow-hidden bg-black/[0.01]">
          {program.studienordnung_url ? (
            <div className="h-full flex flex-col">
              <iframe
                src={`/api/pdf-proxy?url=${encodeURIComponent(program.studienordnung_url)}#toolbar=0&navpanes=0&scrollbar=0`}
                className="flex-1 w-full"
                title="Curriculum document"
                onError={() => {/* silent — user can use open in new tab */}}
              />
              {/* Fallback shown below iframe in case it's blocked */}
              <div className="px-4 py-3 border-t border-border bg-background text-xs text-muted-foreground flex items-center gap-2">
                <FileText className="h-3.5 w-3.5" />
                <span>If the document doesn&apos;t load, use &quot;Open in new tab&quot; above.</span>
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center">
              <EmptyState
                title="No curriculum document"
                description="No study regulations document is available for this program."
                icon={FileText}
              />
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
