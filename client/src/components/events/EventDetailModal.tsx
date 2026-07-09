import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, X, Pencil, Trash2, Clock, Tag } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { CategoryIcon } from '@/components/categories/categoryIcons'
import { eventsApi } from '@/lib/api'
import type { Event, EventStatus } from '@/lib/types'

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function formatEventTime(event: Event): string {
  if (!event.startAt) return ''
  const d = new Date(event.startAt)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

  let dateLabel: string
  if (sameDay(d, today)) dateLabel = 'Today'
  else if (sameDay(d, tomorrow)) dateLabel = 'Tomorrow'
  else dateLabel = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

  const timeStr = formatTime(event.startAt)
  if (event.endAt) return `${dateLabel}, ${timeStr} - ${formatTime(event.endAt)}`
  return `${dateLabel}, ${timeStr}`
}

const GOAL_TONE: Record<string, 'focus' | 'active' | 'bench' | 'neutral'> = {
  focus: 'focus',
  active: 'active',
  bench: 'bench',
  closed: 'neutral',
}

interface EventDetailModalProps {
  open: boolean
  onClose: () => void
  event: Event | null
  onEdit: (event: Event) => void
}

export function EventDetailModal({ open, onClose, event, onEdit }: EventDetailModalProps) {
  const qc = useQueryClient()

  const statusMutation = useMutation({
    mutationFn: (status: EventStatus) => eventsApi.setStatus(event!.id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
      onClose()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => eventsApi.delete(event!.id),
    onSuccess: () => {
      qc.setQueriesData<Event[]>({ queryKey: ['events'] }, (old) =>
        old ? old.filter((e) => e.id !== event!.id) : old,
      )
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
      onClose()
    },
  })

  if (!event) return null

  const isPending = event.status === 'pending'
  const busy = statusMutation.isPending || deleteMutation.isPending
  const timeLabel = formatEventTime(event)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={event.title}
      footer={
        <>
          <Button
            variant="destructive"
            onClick={() => deleteMutation.mutate()}
            loading={deleteMutation.isPending}
            disabled={statusMutation.isPending}
            className="mr-auto"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" strokeWidth={2} />
            Delete
          </Button>
          <Button
            variant="ghost"
            onClick={() => { onClose(); onEdit(event) }}
            disabled={busy}
          >
            <Pencil className="mr-1.5 h-3.5 w-3.5" strokeWidth={2} />
            Edit
          </Button>
          {isPending && (
            <>
              <Button
                variant="ghost"
                onClick={() => statusMutation.mutate('skipped')}
                loading={statusMutation.isPending && statusMutation.variables === 'skipped'}
                disabled={deleteMutation.isPending}
              >
                <X className="mr-1.5 h-3.5 w-3.5" strokeWidth={2.5} />
                Skip
              </Button>
              <Button
                onClick={() => statusMutation.mutate('done')}
                loading={statusMutation.isPending && statusMutation.variables === 'done'}
                disabled={deleteMutation.isPending}
              >
                <Check className="mr-1.5 h-3.5 w-3.5" strokeWidth={2.5} />
                Done
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {timeLabel && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4 shrink-0" strokeWidth={2} />
            <span>{timeLabel}</span>
          </div>
        )}

        {event.category && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Tag className="h-4 w-4 shrink-0" strokeWidth={2} />
            <span className="flex items-center gap-1.5">
              <CategoryIcon icon={event.category.icon} color={event.category.color} size={13} strokeWidth={2} />
              {event.category.name}
            </span>
          </div>
        )}

        {event.goals.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {event.goals.map((g) => (
              <Badge key={g.id} tone={GOAL_TONE[g.status] ?? 'neutral'}>{g.title}</Badge>
            ))}
          </div>
        )}

        {event.status !== 'pending' && (
          <div className="flex items-center gap-2">
            <Badge tone={event.status === 'done' ? 'green' : 'neutral'}>
              {event.status === 'done' ? 'Completed' : 'Skipped'}
            </Badge>
          </div>
        )}
      </div>
    </Modal>
  )
}
