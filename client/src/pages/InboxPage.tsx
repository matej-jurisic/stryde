import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, X, Pencil, CalendarPlus, Trash2, Plus, Clock } from 'lucide-react'
import { eventsApi } from '@/lib/api'
import type { Event, EventStatus } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EventModal } from '@/components/events/EventModal'
import { PageHeader } from '@/components/layout/PageHeader'

// --- date helpers ---

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function formatEventDate(startAt: string, endAt: string | null): string {
  const start = new Date(startAt)
  const now = new Date()
  const todayStart = startOfDay(now)
  const tomorrowStart = new Date(todayStart.getTime() + 86400000)
  const dayStart = startOfDay(start)

  let dayLabel: string
  if (dayStart.getTime() === todayStart.getTime()) {
    dayLabel = 'Today'
  } else if (dayStart.getTime() === tomorrowStart.getTime()) {
    dayLabel = 'Tomorrow'
  } else {
    dayLabel = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  const timeStr = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (endAt) {
    const end = new Date(endAt)
    const endTime = end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    return `${dayLabel}, ${timeStr} - ${endTime}`
  }
  return `${dayLabel}, ${timeStr}`
}

type Group = 'overdue' | 'today' | 'floating' | 'upcoming' | 'done'

function classify(e: Event): Group {
  if (e.status !== 'pending') return 'done'
  if (!e.startAt) return 'floating'
  if (e.isOverdue) return 'overdue'

  const start = new Date(e.startAt)
  const todayStart = startOfDay(new Date())
  const tomorrowStart = new Date(todayStart.getTime() + 86400000)

  if (start < tomorrowStart) return 'today'
  return 'upcoming'
}

const GROUP_ORDER: Group[] = ['overdue', 'today', 'floating', 'upcoming', 'done']

const GROUP_LABELS: Record<Group, string> = {
  overdue: 'Overdue',
  today: 'Today',
  floating: 'Unscheduled',
  upcoming: 'Upcoming',
  done: 'Completed / Skipped',
}

// --- row component ---

interface InboxRowProps {
  event: Event
  onEdit: (e: Event) => void
  onSchedule: (e: Event) => void
}

function InboxRow({ event, onEdit, onSchedule }: InboxRowProps) {
  const qc = useQueryClient()

  const statusMutation = useMutation({
    mutationFn: (status: EventStatus) => eventsApi.setStatus(event.id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => eventsApi.delete(event.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
    },
  })

  const isPending = event.status === 'pending'
  const isFloating = !event.startAt

  return (
    <li className="group flex items-center gap-3 border-b border-border bg-card px-5 py-3 last:border-b-0 hover:bg-muted/40 transition-colors">
      {/* Checkbox */}
      <button
        onClick={() => isPending && statusMutation.mutate('done')}
        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
          event.status === 'done'
            ? 'border-primary bg-primary text-primary-foreground'
            : event.status === 'skipped'
              ? 'border-dashed border-muted-foreground text-muted-foreground'
              : 'border-border bg-background hover:border-primary'
        }`}
      >
        {event.status === 'done' && <Check className="h-3 w-3" strokeWidth={3} />}
        {event.status === 'skipped' && <X className="h-3 w-3" strokeWidth={3} />}
      </button>

      {/* Title + meta */}
      <div className="min-w-0 flex-1">
        <span className={`text-sm ${event.status !== 'pending' ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
          {event.title}
        </span>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {event.startAt && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" strokeWidth={2} />
              {formatEventDate(event.startAt, event.endAt)}
            </span>
          )}
          {event.goals.map((g) => (
            <Badge key={g.id} tone="focus">{g.title}</Badge>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-0.5 transition-opacity opacity-100 md:opacity-0 group-hover:opacity-100">
        {isPending && (
          <>
            <button
              onClick={() => statusMutation.mutate('skipped')}
              title="Skip"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
            {isFloating && (
              <button
                onClick={() => onSchedule(event)}
                title="Schedule"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-primary"
              >
                <CalendarPlus className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            )}
          </>
        )}
        <button
          onClick={() => onEdit(event)}
          title="Edit"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <button
          onClick={() => deleteMutation.mutate()}
          title="Delete"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
    </li>
  )
}

// --- page ---

export function InboxPage() {
  const [modalOpen, setModalOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState<Event | undefined>()
  const [scheduleMode, setScheduleMode] = useState(false)

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['events', 'all'],
    queryFn: () => eventsApi.list(),
  })

  function openCreate() {
    setEditingEvent(undefined)
    setScheduleMode(false)
    setModalOpen(true)
  }

  function openEdit(event: Event) {
    setEditingEvent(event)
    setScheduleMode(false)
    setModalOpen(true)
  }

  function openSchedule(event: Event) {
    setEditingEvent(event)
    setScheduleMode(true)
    setModalOpen(true)
  }

  const groups = new Map<Group, Event[]>()
  for (const g of GROUP_ORDER) groups.set(g, [])
  for (const e of events) groups.get(classify(e))!.push(e)

  // sort each group
  for (const [key, list] of groups) {
    if (key === 'floating' || key === 'done') continue
    list.sort((a, b) => {
      const aDate = a.startAt ? new Date(a.startAt).getTime() : 0
      const bDate = b.startAt ? new Date(b.startAt).getTime() : 0
      return aDate - bDate
    })
  }

  const hasAny = events.length > 0

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Inbox"
        action={
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1.5 h-3.5 w-3.5" strokeWidth={2.5} />
            New Event
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <div className="mx-auto max-w-2xl">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : !hasAny ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 15l3.5-9h9L20 15H4z" />
                  <path d="M4 15v4a1 1 0 001 1h14a1 1 0 001-1v-4" />
                  <path d="M9 20a3 3 0 006 0" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Inbox is empty</p>
                <p className="mt-0.5 text-xs text-muted-foreground">All your events will appear here.</p>
              </div>
              <Button size="sm" onClick={openCreate}>New Event</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {GROUP_ORDER.map((key) => {
                const list = groups.get(key)!
                if (list.length === 0) return null
                return (
                  <div key={key}>
                    <p className={`mb-2 px-1 text-xs font-semibold uppercase tracking-wide ${
                        key === 'overdue' ? 'text-destructive' : 'text-muted-foreground'
                      }`}>
                        {GROUP_LABELS[key]}
                      </p>
                    <div className="overflow-hidden rounded-lg border border-border">
                      <ul>
                        {list.map((e) => (
                          <InboxRow key={e.id} event={e} onEdit={openEdit} onSchedule={openSchedule} />
                        ))}
                      </ul>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <EventModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        event={editingEvent}
        focusStartAt={scheduleMode}
      />
    </div>
  )
}
