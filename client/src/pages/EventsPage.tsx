import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, X, Pencil, Trash2, Plus } from 'lucide-react'
import { eventsApi } from '@/lib/api'
import type { Event, EventStatus } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EventModal } from '@/components/events/EventModal'
import { PageHeader } from '@/components/layout/PageHeader'

function formatDateTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

interface EventRowProps {
  event: Event
  onEdit: (e: Event) => void
}

function EventRow({ event, onEdit }: EventRowProps) {
  const qc = useQueryClient()

  const statusMutation = useMutation({
    mutationFn: (status: EventStatus) => eventsApi.setStatus(event.id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: () => eventsApi.delete(event.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
  })

  const isPending = event.status === 'pending'

  return (
    <div className="group flex items-start gap-3 border-b border-border py-3 last:border-b-0 px-5">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
            event.status === 'done'
              ? 'border-primary bg-primary text-primary-foreground'
              : event.status === 'skipped'
                ? 'border-dashed border-muted-foreground text-muted-foreground'
                : 'border-border bg-background'
          }`}
        >
          {event.status === 'done' && <Check className="h-3 w-3" strokeWidth={3} />}
          {event.status === 'skipped' && <X className="h-3 w-3" strokeWidth={3} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-sm ${event.status !== 'pending' ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
            {event.title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {(event.startAt || event.endAt) && (
              <span className="font-mono text-[11px] text-muted-foreground">
                {event.startAt && event.endAt
                  ? `${formatDateTime(event.startAt)} - ${formatDateTime(event.endAt)}`
                  : `Due ${formatDateTime((event.startAt ?? event.endAt)!)}`}
              </span>
            )}
            {event.goals.map((g) => (
              <Badge key={g.id} tone="focus">{g.title}</Badge>
            ))}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 transition-opacity opacity-100 md:opacity-0 group-hover:opacity-100">
        {isPending && (
          <>
            <button
              onClick={() => statusMutation.mutate('done')}
              title="Mark done"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
            <button
              onClick={() => statusMutation.mutate('skipped')}
              title="Skip"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
          </>
        )}
        <button
          onClick={() => onEdit(event)}
          title="Edit"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <button
          onClick={() => deleteMutation.mutate()}
          title="Delete"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}

export function EventsPage() {
  const [modalOpen, setModalOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState<Event | undefined>()

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['events'],
    queryFn: () => eventsApi.list(),
  })

  function openCreate() {
    setEditingEvent(undefined)
    setModalOpen(true)
  }

  function openEdit(event: Event) {
    setEditingEvent(event)
    setModalOpen(true)
  }

  const pending = events.filter((e) => e.status === 'pending')
  const completed = events.filter((e) => e.status !== 'pending')

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Events"
        action={
          <Button onClick={openCreate} size="sm">
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
          ) : events.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <path d="M8 2v3M16 2v3M3 10h18" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">No events yet</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Create your first event to get started.</p>
              </div>
              <Button size="sm" onClick={openCreate}>New Event</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {pending.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                  {pending.map((e) => (
                    <EventRow key={e.id} event={e} onEdit={openEdit} />
                  ))}
                </div>
              )}
              {completed.length > 0 && (
                <div>
                  <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Completed
                  </p>
                  <div className="overflow-hidden rounded-lg border border-border bg-card">
                    {completed.map((e) => (
                      <EventRow key={e.id} event={e} onEdit={openEdit} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <EventModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        event={editingEvent}
      />
    </div>
  )
}
