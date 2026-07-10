import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, X, Pencil, Trash2, Clock, CalendarPlus } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { CategoryIcon } from '@/components/categories/categoryIcons'
import { occurrencesApi } from '@/lib/api'
import type { Occurrence, EventStatus } from '@/lib/types'

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function formatDuration(minutes: number | null): string {
  if (!minutes) return ''
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

function formatOccurrenceTime(o: Occurrence): string {
  const refIso = o.startAt ?? o.endAt
  if (!refIso) return ''

  const d = new Date(refIso)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

  let dateLabel: string
  if (sameDay(d, today)) dateLabel = 'Today'
  else if (sameDay(d, tomorrow)) dateLabel = 'Tomorrow'
  else dateLabel = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

  if (o.isAllDay) {
    const dur = formatDuration(o.durationMinutes)
    return dur ? `${dateLabel}, All day ~${dur}` : `${dateLabel}, All day`
  }

  if (o.startAt && o.endAt) {
    const range = `${formatTime(o.startAt)} - ${formatTime(o.endAt)}`
    const dur = formatDuration(o.durationMinutes)
    return dur ? `${dateLabel}, ${range} ~${dur}` : `${dateLabel}, ${range}`
  }

  if (o.startAt) return `${dateLabel}, ${formatTime(o.startAt)}`
  return `${dateLabel}, Due ${formatTime(o.endAt!)}`
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
  event: Occurrence | null
  onEdit: (o: Occurrence) => void
  onSchedule?: (o: Occurrence) => void
}

export function EventDetailModal({ open, onClose, event: occurrence, onEdit, onSchedule }: EventDetailModalProps) {
  const qc = useQueryClient()

  const statusMutation = useMutation({
    mutationFn: (status: EventStatus) => occurrencesApi.setStatus(occurrence!.id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
      onClose()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => occurrencesApi.delete(occurrence!.id),
    onSuccess: () => {
      qc.setQueriesData<Occurrence[]>({ queryKey: ['events'] }, (old) =>
        old ? old.filter((o) => o.id !== occurrence!.id) : old,
      )
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
      onClose()
    },
  })

  if (!occurrence) return null

  const isPending = occurrence.status === 'pending'
  const busy = statusMutation.isPending || deleteMutation.isPending
  const timeLabel = formatOccurrenceTime(occurrence)
  const category = occurrence.activity.category
  const goal = occurrence.activity.goal

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={occurrence.effectiveTitle}
      footer={
        <>
          <button
            onClick={() => deleteMutation.mutate()}
            disabled={busy}
            aria-label="Delete"
            className="mr-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
          >
            {deleteMutation.isPending
              ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              : <Trash2 className="h-4 w-4" strokeWidth={2} />}
          </button>

          <button
            onClick={() => { onClose(); onEdit(occurrence) }}
            disabled={busy}
            aria-label="Edit"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            <Pencil className="h-4 w-4" strokeWidth={2} />
          </button>

          {isPending && occurrence.isPlanned && onSchedule && (
            <button
              onClick={() => { onClose(); onSchedule(occurrence) }}
              disabled={busy}
              aria-label="Schedule"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              <CalendarPlus className="h-4 w-4" strokeWidth={2} />
            </button>
          )}

          {isPending && (
            <>
              <button
                onClick={() => statusMutation.mutate('skipped')}
                disabled={busy}
                aria-label="Skip"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                {statusMutation.isPending && statusMutation.variables === 'skipped'
                  ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  : <X className="h-4 w-4" strokeWidth={2.5} />}
              </button>

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

        {category && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CategoryIcon icon={category.icon} color={category.color} size={16} strokeWidth={2} />
            {category.name}
          </div>
        )}

        {goal && (
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={GOAL_TONE[goal.status] ?? 'neutral'}>{goal.title}</Badge>
          </div>
        )}

        {occurrence.status !== 'pending' && (
          <div className="flex items-center gap-2">
            <Badge tone={occurrence.status === 'done' ? 'green' : 'neutral'}>
              {occurrence.status === 'done' ? 'Completed' : 'Skipped'}
            </Badge>
          </div>
        )}
      </div>
    </Modal>
  )
}
