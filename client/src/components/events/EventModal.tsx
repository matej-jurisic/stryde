import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { eventsApi, goalsApi, categoriesApi, baseEventsApi } from '@/lib/api'
import type { BaseEventSummary, Event } from '@/lib/types'

interface FormState {
  title: string
  startAt: string
  endAt: string
  goalIds: string[]
  categoryId: string | null
  baseEventId: string | null
  windowStart: string
  windowEnd: string
  windowDurationHours: string
  windowDurationMins: string
}

interface Errors {
  title?: string
  endAt?: string
  windowEnd?: string
  windowDuration?: string
}

function validate(form: FormState, useStartEnd: boolean, useWindow: boolean): Errors {
  const errs: Errors = {}
  if (!form.title.trim()) errs.title = 'Title is required.'
  if (form.title.length > 255) errs.title = 'Title cannot exceed 255 characters.'
  if (useStartEnd && form.startAt && form.endAt && form.endAt <= form.startAt) {
    errs.endAt = 'End time must be after start time.'
  }
  if (useWindow) {
    if (form.windowEnd && form.windowStart && form.windowEnd <= form.windowStart) {
      errs.windowEnd = 'Window end must be after window start.'
    }
    const totalMins = (parseInt(form.windowDurationHours || '0') * 60) + parseInt(form.windowDurationMins || '0')
    if (totalMins <= 0) errs.windowDuration = 'Duration must be greater than zero.'
    if (form.windowStart && form.windowEnd) {
      const windowMins = (new Date(form.windowEnd).getTime() - new Date(form.windowStart).getTime()) / 60000
      if (totalMins > windowMins) errs.windowDuration = 'Duration cannot exceed the length of the window.'
    }
  }
  return errs
}

function toInputValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`
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
  defaultStartAt?: string    // "YYYY-MM-DDTHH:mm" — pre-fills start/due when creating from a calendar slot
  defaultEndAt?: string      // "YYYY-MM-DDTHH:mm" — pre-fills end when creating via drag; also triggers start-end mode
  defaultBaseEvent?: BaseEventSummary  // pre-fills from a recommendation pattern suggestion
}

function durationToHM(minutes: number | null): { h: string; m: string } {
  if (!minutes) return { h: '', m: '' }
  return { h: String(Math.floor(minutes / 60)), m: String(minutes % 60) }
}

function buildInitialForm(
  event: Event | undefined,
  defaultBaseEvent: BaseEventSummary | undefined,
  defaultStartAt: string | undefined,
  defaultEndAt: string | undefined,
): FormState {
  const dur = durationToHM(event?.windowDurationMinutes ?? null)
  if (defaultBaseEvent && !event) {
    return {
      title: defaultBaseEvent.title,
      startAt: defaultStartAt ?? '',
      endAt: defaultEndAt ?? '',
      goalIds: defaultBaseEvent.goalId ? [defaultBaseEvent.goalId] : [],
      categoryId: defaultBaseEvent.category?.id ?? null,
      baseEventId: defaultBaseEvent.id,
      windowStart: '',
      windowEnd: '',
      windowDurationHours: '',
      windowDurationMins: '',
    }
  }
  return {
    title: event?.title ?? '',
    startAt: event ? toInputValue(event.startAt) : (defaultStartAt ?? ''),
    endAt: event ? toInputValue(event.endAt) : (defaultEndAt ?? ''),
    goalIds: event?.goals.map((g) => g.id) ?? [],
    categoryId: event?.category?.id ?? null,
    baseEventId: null,
    windowStart: event ? toInputValue(event.windowStart) : '',
    windowEnd: event ? toInputValue(event.windowEnd) : '',
    windowDurationHours: dur.h,
    windowDurationMins: dur.m,
  }
}

type ScheduleMode = 'due' | 'scheduled' | 'window'

export function EventModal({ open, onClose, event, focusStartAt, defaultStartAt, defaultEndAt, defaultBaseEvent }: EventModalProps) {
  const qc = useQueryClient()
  const isEdit = Boolean(event)

  const [form, setForm] = useState<FormState>(() =>
    buildInitialForm(event, defaultBaseEvent, defaultStartAt, defaultEndAt),
  )
  const [errors, setErrors] = useState<Errors>({})
  const [isAllDay, setIsAllDay] = useState(() => event?.isAllDay ?? false)
  const [useStartEnd, setUseStartEnd] = useState(() =>
    event ? Boolean(event.endAt) : Boolean(defaultEndAt),
  )
  const [useWindow, setUseWindow] = useState(() => Boolean(event?.windowStart))
  const [linkedBaseEvent, setLinkedBaseEvent] = useState<BaseEventSummary | null>(() =>
    defaultBaseEvent && !event ? defaultBaseEvent : null,
  )

  useEffect(() => {
    if (open) {
      setErrors({})
    }
  }, [open])

  const { data: goals = [] } = useQuery({
    queryKey: ['goals'],
    queryFn: () => goalsApi.list(),
    enabled: open,
  })

  const templateQueries = useQueries({
    queries: form.goalIds.map((goalId) => ({
      queryKey: ['base-events', goalId],
      queryFn: () => baseEventsApi.listByGoal(goalId),
      enabled: open && !isEdit && form.goalIds.length > 0,
      staleTime: 30 * 1000,
    })),
  })
  const availableTemplates = templateQueries.flatMap((q) => q.data ?? [])

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list(),
    enabled: open,
  })

  const mutation = useMutation({
    mutationFn: () => {
      const windowDurationMinutes = useWindow
        ? (parseInt(form.windowDurationHours || '0') * 60) + parseInt(form.windowDurationMins || '0')
        : null
      const payload = {
        title: form.title.trim(),
        startAt: useWindow ? null : toIso(form.startAt),
        endAt: useWindow || isAllDay ? null : (useStartEnd ? toIso(form.endAt) : null),
        isAllDay: useWindow ? false : isAllDay,
        windowStart: useWindow ? toIso(form.windowStart) : null,
        windowEnd: useWindow ? toIso(form.windowEnd) : null,
        windowDurationMinutes: useWindow ? windowDurationMinutes : null,
        goalIds: form.goalIds,
        categoryId: form.categoryId,
        baseEventId: form.baseEventId,
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
    const errs = validate(form, useStartEnd, useWindow)
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }
    mutation.mutate()
  }

  function enableStartEnd() {
    setIsAllDay(false)
    setUseWindow(false)
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

  function toggleAllDay() {
    if (!isAllDay) {
      const dateOnly = form.startAt ? form.startAt.substring(0, 10) : ''
      setForm((f) => ({ ...f, startAt: dateOnly ? dateOnly + 'T00:00' : '', endAt: '' }))
      setUseStartEnd(false)
      setUseWindow(false)
      setErrors((e) => ({ ...e, endAt: undefined }))
    }
    setIsAllDay((v) => !v)
  }

  function enableWindow() {
    setUseWindow(true)
    setUseStartEnd(false)
    setIsAllDay(false)
    setForm((f) => ({
      ...f,
      endAt: '',
      windowStart: f.windowStart || f.startAt,
      windowEnd: f.windowEnd || f.endAt,
    }))
    setErrors({})
  }

  function disableWindow() {
    setUseWindow(false)
    setForm((f) => ({ ...f, windowStart: '', windowEnd: '', windowDurationHours: '', windowDurationMins: '' }))
    setErrors({})
  }

  function selectBaseEvent(be: BaseEventSummary) {
    setLinkedBaseEvent(be)
    setForm((f) => ({
      ...f,
      title: be.title,
      categoryId: be.category?.id ?? null,
      baseEventId: be.id,
    }))
  }

  function clearBaseEvent() {
    setLinkedBaseEvent(null)
    setForm((f) => ({ ...f, baseEventId: null }))
  }

  function toggleGoal(id: string) {
    setForm((f) => ({
      ...f,
      goalIds: f.goalIds.includes(id) ? f.goalIds.filter((g) => g !== id) : [...f.goalIds, id],
    }))
  }

  function switchMode(mode: ScheduleMode) {
    if (mode === 'due') {
      if (useWindow) disableWindow()
      if (useStartEnd) disableStartEnd()
    } else if (mode === 'scheduled') {
      enableStartEnd()
    } else {
      enableWindow()
    }
  }

  const scheduleMode: ScheduleMode = useWindow ? 'window' : useStartEnd ? 'scheduled' : 'due'
  const activeGoals = goals.filter((g) => g.status !== 'closed')

  const segmentClass = (active: boolean) =>
    `flex-1 rounded-md py-2 text-xs font-medium transition-colors ${
      active
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground'
    }`

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Event' : 'New Event'}
      footer={
        <>
          {!isEdit && (
            <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          )}
          <Button onClick={handleSubmit} loading={mutation.isPending}>
            {isEdit ? 'Save Changes' : 'Create Event'}
          </Button>
        </>
      }
    >
      {/* Title */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground">Title</label>
        <input
          type="text"
          placeholder="What needs to get done?"
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
          autoFocus
          className={`h-11 rounded-lg border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring ${errors.title ? 'border-destructive' : 'border-input'}`}
        />
        {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
      </div>

      {/* Scheduling section */}
      <div className="flex flex-col gap-3">
        {/* Mode selector */}
        <div className="grid grid-cols-3 gap-0.5 rounded-lg border border-border bg-muted p-0.5">
          <button type="button" onClick={() => switchMode('due')} className={segmentClass(scheduleMode === 'due')}>Due date</button>
          <button type="button" onClick={() => switchMode('scheduled')} className={segmentClass(scheduleMode === 'scheduled')}>Scheduled</button>
          <button type="button" onClick={() => switchMode('window')} className={segmentClass(scheduleMode === 'window')}>Window</button>
        </div>

        {/* Due date fields */}
        {scheduleMode === 'due' && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Date</label>
              <button
                type="button"
                onClick={toggleAllDay}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  isAllDay
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground'
                }`}
              >
                All day
              </button>
            </div>
            <input
              type={isAllDay ? 'date' : 'datetime-local'}
              value={isAllDay ? (form.startAt ? form.startAt.substring(0, 10) : '') : form.startAt}
              onChange={(e) => {
                if (isAllDay) {
                  setForm((f) => ({ ...f, startAt: e.target.value ? e.target.value + 'T00:00' : '' }))
                } else {
                  setForm((f) => ({ ...f, startAt: e.target.value }))
                }
              }}
              autoFocus={focusStartAt}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        )}

        {/* Scheduled (start + end) fields */}
        {scheduleMode === 'scheduled' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
        )}

        {/* Window fields */}
        {scheduleMode === 'window' && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="Window start"
                type="datetime-local"
                value={form.windowStart}
                onChange={(e) => setForm((f) => ({ ...f, windowStart: e.target.value }))}
                autoFocus={focusStartAt}
              />
              <Field
                label="Window end"
                type="datetime-local"
                value={form.windowEnd}
                onChange={(e) => setForm((f) => ({ ...f, windowEnd: e.target.value }))}
                error={errors.windowEnd}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Duration</label>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex h-9 items-center gap-2 rounded-lg border border-input bg-background px-3">
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={form.windowDurationHours}
                    onChange={(e) => setForm((f) => ({ ...f, windowDurationHours: e.target.value }))}
                    className="min-w-0 flex-1 bg-transparent text-sm text-foreground focus:outline-none"
                  />
                  <span className="shrink-0 text-sm text-muted-foreground">h</span>
                </div>
                <div className="flex h-9 items-center gap-2 rounded-lg border border-input bg-background px-3">
                  <input
                    type="number"
                    min="0"
                    max="59"
                    placeholder="0"
                    value={form.windowDurationMins}
                    onChange={(e) => setForm((f) => ({ ...f, windowDurationMins: e.target.value }))}
                    className="min-w-0 flex-1 bg-transparent text-sm text-foreground focus:outline-none"
                  />
                  <span className="shrink-0 text-sm text-muted-foreground">min</span>
                </div>
              </div>
              {errors.windowDuration && <p className="text-xs text-destructive">{errors.windowDuration}</p>}
            </div>
          </div>
        )}
      </div>

      {/* Goals */}
      {activeGoals.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Goals</span>
          <div className="flex flex-wrap items-center gap-2">
            {activeGoals.filter((g) => form.goalIds.includes(g.id)).map((g) => (
              <span key={g.id} className="flex items-center gap-1 rounded-lg border border-primary bg-primary/10 px-2.5 py-1.5 text-sm font-medium text-primary">
                {g.title}
                <button type="button" onClick={() => toggleGoal(g.id)} aria-label={`Remove ${g.title}`} className="ml-0.5 text-primary/60 transition-colors hover:text-primary">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {activeGoals.some((g) => !form.goalIds.includes(g.id)) && (
              <select
                value=""
                onChange={(e) => { if (e.target.value) toggleGoal(e.target.value) }}
                className="h-8 rounded-lg border border-dashed border-border bg-background px-2 text-sm text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Add goal...</option>
                {activeGoals.filter((g) => !form.goalIds.includes(g.id)).map((g) => (
                  <option key={g.id} value={g.id}>{g.title}</option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}

      {/* Category */}
      {categories.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Category</span>
          <select
            value={form.categoryId ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value || null }))}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">No category</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Template picker (create only, shown when a goal is selected and templates exist) */}
      {!isEdit && availableTemplates.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Template</span>
          {linkedBaseEvent ? (
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Using template</span>
                <span className="truncate text-sm font-medium text-foreground">{linkedBaseEvent.title}</span>
              </div>
              <button
                type="button"
                onClick={clearBaseEvent}
                className="ml-3 shrink-0 text-xs text-muted-foreground transition-colors hover:text-destructive"
              >
                Clear
              </button>
            </div>
          ) : (
            <select
              value=""
              onChange={(e) => {
                const be = availableTemplates.find((t) => t.id === e.target.value)
                if (be) selectBaseEvent(be)
              }}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Use a template...</option>
              {availableTemplates.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {mutation.error instanceof Error && (
        <p className="text-sm text-destructive">{mutation.error.message}</p>
      )}
    </Modal>
  )
}
