import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, X, Pencil, Trash2, Clock, CalendarPlus, Copy, MoreHorizontal, Pin, PinOff } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { CategoryIcon } from '@/components/categories/categoryIcons'
import { SkipRescheduleModal } from '@/components/events/SkipRescheduleModal'
import { occurrencesApi } from '@/lib/api'
import { toastError } from '@/store/toasts'
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
  onDuplicate?: (o: Occurrence) => void
}

export function EventDetailModal({ open, onClose, event: occurrence, onEdit, onSchedule, onDuplicate }: EventDetailModalProps) {
  const qc = useQueryClient()
  const [moreOpen, setMoreOpen] = useState(false)
  const [skipOpen, setSkipOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [menuPos, setMenuPos] = useState<{ bottom: number; right: number }>({ bottom: 0, right: 0 })
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const [completedSubtaskIds, setCompletedSubtaskIds] = useState(() => new Set(occurrence?.completedSubtaskIds ?? []))

  useEffect(() => {
    setCompletedSubtaskIds(new Set(occurrence?.completedSubtaskIds ?? []))
  }, [occurrence?.completedSubtaskIds])

  useEffect(() => {
    if (!moreOpen) return
    function close(e: MouseEvent) {
      const target = e.target as Node
      if (moreButtonRef.current?.contains(target)) return
      if (moreMenuRef.current?.contains(target)) return
      setMoreOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [moreOpen])

  function openMore() {
    if (moreButtonRef.current) {
      const rect = moreButtonRef.current.getBoundingClientRect()
      setMenuPos({ bottom: window.innerHeight - rect.top + 4, right: window.innerWidth - rect.right })
    }
    setMoreOpen((o) => !o)
  }

  const subtaskToggleMutation = useMutation({
    mutationFn: (subtaskId: string) => occurrencesApi.toggleSubtask(occurrence!.id, subtaskId),
    onMutate: (subtaskId) => {
      setCompletedSubtaskIds((prev) => {
        const next = new Set(prev)
        if (next.has(subtaskId)) next.delete(subtaskId); else next.add(subtaskId)
        return next
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
    onError: (_, subtaskId) => {
      setCompletedSubtaskIds((prev) => {
        const next = new Set(prev)
        if (next.has(subtaskId)) next.delete(subtaskId); else next.add(subtaskId)
        return next
      })
    },
  })

  const statusMutation = useMutation({
    mutationFn: (status: EventStatus) => occurrencesApi.setStatus(occurrence!.id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
      onClose()
    },
    onError: (err) => toastError(err, 'Could not update the status.'),
  })

  const planMutation = useMutation({
    mutationFn: () => {
      const d = new Date(occurrence!.startAt!)
      d.setHours(0, 0, 0, 0)
      return occurrencesApi.update(occurrence!.id, { title: occurrence!.title, startAt: d.toISOString(), endAt: null, isAllDay: true, isPlanned: true })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
      onClose()
    },
    onError: (err) => toastError(err, 'Could not update the occurrence.'),
  })

  const floatMutation = useMutation({
    mutationFn: () => occurrencesApi.update(occurrence!.id, { title: occurrence!.title, startAt: null, endAt: null, isAllDay: false, isPlanned: false }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
      onClose()
    },
    onError: (err) => toastError(err, 'Could not update the occurrence.'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => occurrencesApi.delete(occurrence!.id),
    onSuccess: () => {
      setConfirmDelete(false)
      qc.setQueriesData<Occurrence[]>({ queryKey: ['events'] }, (old) =>
        old ? old.filter((o) => o.id !== occurrence!.id) : old,
      )
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
      onClose()
    },
    onError: (err) => toastError(err, 'Could not delete the occurrence.'),
  })

  if (!occurrence) return null

  const isPending = occurrence.status === 'pending'
  // SkipRescheduleModal rendered outside the main Modal so it layers on top
  if (skipOpen) return (
    <SkipRescheduleModal
      open={skipOpen}
      onClose={() => setSkipOpen(false)}
      occurrence={occurrence}
      onDone={() => { setSkipOpen(false); onClose() }}
    />
  )
  const busy = statusMutation.isPending || deleteMutation.isPending || planMutation.isPending || floatMutation.isPending
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
            onClick={() => setConfirmDelete(true)}
            disabled={busy}
            aria-label="Delete"
            className="mr-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
          >
            {deleteMutation.isPending
              ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              : <Trash2 className="h-4 w-4" strokeWidth={2} />}
          </button>
          <ConfirmDialog
            open={confirmDelete}
            onClose={() => setConfirmDelete(false)}
            onConfirm={() => deleteMutation.mutate()}
            loading={deleteMutation.isPending}
            title="Delete occurrence?"
            message={`"${occurrence.effectiveTitle}" will be permanently deleted. This cannot be undone.`}
          />

          <button
            ref={moreButtonRef}
            onClick={openMore}
            disabled={busy}
            aria-label="More actions"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            <MoreHorizontal className="h-4 w-4" strokeWidth={2} />
          </button>
          {moreOpen && createPortal(
            <div
              ref={moreMenuRef}
              style={{ position: 'fixed', bottom: menuPos.bottom, right: menuPos.right, zIndex: 60 }}
              className="min-w-[160px] rounded-lg border border-border bg-card py-1 shadow-pop"
            >
              <button
                onClick={() => { setMoreOpen(false); onClose(); onEdit(occurrence) }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
              >
                <Pencil className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2} />
                Edit
              </button>
              {onDuplicate && (
                <button
                  onClick={() => { setMoreOpen(false); onDuplicate(occurrence) }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
                >
                  <Copy className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2} />
                  Duplicate
                </button>
              )}
              {isPending && occurrence.isPlanned && onSchedule && (
                <button
                  onClick={() => { setMoreOpen(false); onClose(); onSchedule(occurrence) }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
                >
                  <CalendarPlus className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2} />
                  Schedule
                </button>
              )}
              {isPending && occurrence.startAt && (
                <>
                  <button
                    onClick={() => { setMoreOpen(false); planMutation.mutate() }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
                  >
                    <Pin className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2} />
                    Plan
                  </button>
                  <button
                    onClick={() => { setMoreOpen(false); floatMutation.mutate() }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
                  >
                    <PinOff className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2} />
                    Float
                  </button>
                </>
              )}
              {isPending && (
                <button
                  onClick={() => { setMoreOpen(false); setSkipOpen(true) }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
                >
                  <X className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2.5} />
                  Skip
                </button>
              )}
            </div>,
            document.body,
          )}

          {isPending ? (
            <>
              <Button
                onClick={() => statusMutation.mutate('done')}
                loading={statusMutation.isPending && statusMutation.variables === 'done'}
                disabled={deleteMutation.isPending}
              >
                <Check className="mr-1.5 h-3.5 w-3.5" strokeWidth={2.5} />
                Done
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() => statusMutation.mutate('pending')}
              loading={statusMutation.isPending}
              disabled={deleteMutation.isPending}
            >
              Reactivate
            </Button>
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

        {occurrence.activity.subtasks.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Subtasks ({completedSubtaskIds.size}/{occurrence.activity.subtasks.length})
            </span>
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {occurrence.activity.subtasks.map((s) => {
                const done = completedSubtaskIds.has(s.id)
                return (
                  <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                    <button
                      onClick={() => subtaskToggleMutation.mutate(s.id)}
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
                        done
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background hover:border-primary'
                      }`}
                    >
                      {done && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                    </button>
                    <span className={`flex-1 text-sm ${done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                      {s.title}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}
