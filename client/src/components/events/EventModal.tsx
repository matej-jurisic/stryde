import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { eventsApi, goalsApi } from '@/lib/api'
import type { Event } from '@/lib/types'

interface FormState {
  title: string
  startAt: string
  endAt: string
  goalIds: string[]
}

interface Errors {
  title?: string
  endAt?: string
}

function validate(form: FormState, useStartEnd: boolean): Errors {
  const errs: Errors = {}
  if (!form.title.trim()) errs.title = 'Title is required.'
  if (form.title.length > 255) errs.title = 'Title cannot exceed 255 characters.'
  if (useStartEnd && form.startAt && form.endAt && form.endAt <= form.startAt) {
    errs.endAt = 'End time must be after start time.'
  }
  return errs
}

function toInputValue(iso: string | null | undefined): string {
  if (!iso) return ''
  return iso.slice(0, 16)
}

function toIso(local: string): string | null {
  if (!local) return null
  return new Date(local).toISOString()
}

function addOneHour(dtLocal: string): string {
  if (!dtLocal) return ''
  const d = new Date(dtLocal)
  d.setHours(d.getHours() + 1)
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`
}

interface EventModalProps {
  open: boolean
  onClose: () => void
  event?: Event
  focusStartAt?: boolean
  defaultStartAt?: string // "YYYY-MM-DDTHH:mm" — pre-fills start/due when creating from a calendar slot
  defaultEndAt?: string   // "YYYY-MM-DDTHH:mm" — pre-fills end when creating via drag; also triggers start-end mode
}

export function EventModal({ open, onClose, event, focusStartAt, defaultStartAt, defaultEndAt }: EventModalProps) {
  const qc = useQueryClient()
  const isEdit = Boolean(event)

  const [form, setForm] = useState<FormState>({
    title: '',
    startAt: '',
    endAt: '',
    goalIds: [],
  })
  const [errors, setErrors] = useState<Errors>({})
  const [useStartEnd, setUseStartEnd] = useState(false)

  useEffect(() => {
    if (open) {
      const hasEnd = event ? Boolean(event.endAt) : Boolean(defaultEndAt)
      setUseStartEnd(hasEnd)
      setForm({
        title: event?.title ?? '',
        startAt: event ? toInputValue(event.startAt) : (defaultStartAt ?? ''),
        endAt: event ? toInputValue(event.endAt) : (defaultEndAt ?? ''),
        goalIds: event?.goals.map((g) => g.id) ?? [],
      })
      setErrors({})
    }
  }, [open, event, defaultStartAt, defaultEndAt])

  const { data: goals = [] } = useQuery({
    queryKey: ['goals'],
    queryFn: () => goalsApi.list(),
    enabled: open,
  })

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        title: form.title.trim(),
        startAt: toIso(form.startAt),
        endAt: useStartEnd ? toIso(form.endAt) : null,
        goalIds: form.goalIds,
      }
      return isEdit
        ? eventsApi.update(event!.id, payload)
        : eventsApi.create(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
      onClose()
    },
  })

  function handleSubmit() {
    const errs = validate(form, useStartEnd)
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }
    mutation.mutate()
  }

  function enableStartEnd() {
    setUseStartEnd(true)
    if (!form.endAt && form.startAt) {
      setForm((f) => ({ ...f, endAt: addOneHour(f.startAt) }))
    }
  }

  function disableStartEnd() {
    setUseStartEnd(false)
    setForm((f) => ({ ...f, endAt: '' }))
    setErrors((e) => ({ ...e, endAt: undefined }))
  }

  function toggleGoal(id: string) {
    setForm((f) => ({
      ...f,
      goalIds: f.goalIds.includes(id) ? f.goalIds.filter((g) => g !== id) : [...f.goalIds, id],
    }))
  }

  const activeGoals = goals.filter((g) => g.status !== 'closed')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Event' : 'New Event'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button onClick={handleSubmit} loading={mutation.isPending}>
            {isEdit ? 'Save Changes' : 'Create Event'}
          </Button>
        </>
      }
    >
      <Field
        label="Title"
        value={form.title}
        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        placeholder="What needs to get done?"
        error={errors.title}
        autoFocus
      />

      {!useStartEnd ? (
        <div className="flex flex-col gap-1.5">
          <Field
            label="Due date"
            type="datetime-local"
            value={form.startAt}
            onChange={(e) => setForm((f) => ({ ...f, startAt: e.target.value }))}
            autoFocus={focusStartAt}
          />
          <button
            type="button"
            onClick={enableStartEnd}
            className="self-start text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            + Set start and end time
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Start"
              type="datetime-local"
              value={form.startAt}
              onChange={(e) => setForm((f) => ({ ...f, startAt: e.target.value }))}
              autoFocus={focusStartAt}
            />
            <Field
              label="End"
              type="datetime-local"
              value={form.endAt}
              onChange={(e) => setForm((f) => ({ ...f, endAt: e.target.value }))}
              error={errors.endAt}
            />
          </div>
          <button
            type="button"
            onClick={disableStartEnd}
            className="self-start text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Use due date only
          </button>
        </div>
      )}

      {activeGoals.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-foreground">Goals</span>
          <div className="flex flex-wrap gap-2">
            {activeGoals.map((g) => {
              const selected = form.goalIds.includes(g.id)
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => toggleGoal(g.id)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    selected
                      ? 'bg-primary/10 border-primary text-primary'
                      : 'bg-transparent border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                  }`}
                >
                  {g.title}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {mutation.error instanceof Error && (
        <p className="text-sm text-destructive">{mutation.error.message}</p>
      )}
    </Modal>
  )
}
