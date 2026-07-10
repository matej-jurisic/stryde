import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { occurrencesApi, activitiesApi, categoriesApi, goalsApi } from '@/lib/api'
import type { Activity, ActivityKind, Occurrence } from '@/lib/types'

interface FormState {
  activityId: string
  title: string
  categoryId: string
  goalId: string
  startAt: string
  endAt: string
  windowStart: string
  windowEnd: string
  windowDurationHours: string
  windowDurationMins: string
}

interface Errors {
  activityId?: string
  title?: string
  endAt?: string
  windowEnd?: string
  windowDuration?: string
}

function validate(form: FormState, kind: ActivityKind, useStartEnd: boolean, useWindow: boolean): Errors {
  const errs: Errors = {}
  if (kind === 'activity' && !form.activityId) errs.activityId = 'Please select an activity.'
  if (kind === 'event' && !form.title.trim()) errs.title = 'Title is required.'
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

function todayLocal(): string {
  const d = new Date()
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T00:00`
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

function durationToHM(minutes: number | null): { h: string; m: string } {
  if (!minutes) return { h: '', m: '' }
  return { h: String(Math.floor(minutes / 60)), m: String(minutes % 60) }
}

interface OccurrenceModalProps {
  open: boolean
  onClose: () => void
  occurrence?: Occurrence
  focusStartAt?: boolean
  defaultStartAt?: string
  defaultEndAt?: string
  defaultActivity?: Activity
  defaultMode?: ScheduleMode
  scheduleOnly?: boolean
}

type ScheduleMode = 'due' | 'scheduled' | 'window' | 'floating'

export function EventModal({ open, onClose, occurrence, focusStartAt, defaultStartAt, defaultEndAt, defaultActivity, defaultMode, scheduleOnly }: OccurrenceModalProps) {
  const qc = useQueryClient()
  const isEdit = Boolean(occurrence)

  const dur = durationToHM(occurrence?.windowDurationMinutes ?? null)

  const isEventKind = occurrence?.activity.kind === 'event'

  const [kind, setKind] = useState<ActivityKind>(() =>
    isEventKind ? 'event' : 'activity'
  )

  const [form, setForm] = useState<FormState>(() => ({
    activityId: occurrence?.activityId ?? defaultActivity?.id ?? '',
    title: isEventKind
      ? (occurrence?.activity.title ?? '')
      : (occurrence?.title ?? ''),
    categoryId: occurrence?.activity.categoryId ?? '',
    goalId: occurrence?.activity.goalId ?? '',
    startAt: occurrence
      ? ((scheduleOnly || defaultMode === 'scheduled') && !occurrence.startAt && occurrence.windowStart
          ? toInputValue(occurrence.windowStart)
          : toInputValue(occurrence.startAt))
      : (defaultStartAt ?? todayLocal()),
    endAt: occurrence
      ? (scheduleOnly && occurrence.windowEnd ? toInputValue(occurrence.windowEnd) : toInputValue(occurrence.endAt))
      : (defaultEndAt ?? ''),
    windowStart: occurrence ? toInputValue(occurrence.windowStart) : todayLocal(),
    windowEnd: occurrence ? toInputValue(occurrence.windowEnd) : '',
    windowDurationHours: dur.h,
    windowDurationMins: dur.m,
  }))

  const [errors, setErrors] = useState<Errors>({})
  const [isAllDay, setIsAllDay] = useState(() => occurrence?.isAllDay ?? false)
  const [useStartEnd, setUseStartEnd] = useState(() => {
    if (scheduleOnly) return true
    if (defaultMode) return defaultMode === 'scheduled'
    return occurrence ? Boolean(occurrence.endAt) : Boolean(defaultEndAt)
  })
  const [useWindow, setUseWindow] = useState(() => {
    if (scheduleOnly) return false
    if (defaultMode) return defaultMode === 'window'
    return Boolean(occurrence?.windowStart)
  })
  const [isFloating, setIsFloating] = useState(() => {
    if (scheduleOnly || defaultMode) return defaultMode === 'floating'
    return occurrence ? (!occurrence.startAt && !occurrence.windowStart && !occurrence.isAllDay) : false
  })

  // New activity inline creation
  const [showNewActivity, setShowNewActivity] = useState(false)
  const [newActivityTitle, setNewActivityTitle] = useState('')
  const [newActivityCategoryId, setNewActivityCategoryId] = useState('')

  useEffect(() => {
    if (open) setErrors({})
  }, [open])

  const { data: activities = [] } = useQuery({
    queryKey: ['activities'],
    queryFn: () => activitiesApi.list(),
    enabled: open && kind === 'activity',
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list(),
    enabled: open && (showNewActivity || kind === 'event'),
  })

  const { data: goals = [] } = useQuery({
    queryKey: ['goals'],
    queryFn: () => goalsApi.list(),
    enabled: open && kind === 'event',
  })

  const createActivityMutation = useMutation({
    mutationFn: ({ title, categoryId }: { title: string; categoryId: string | null }) =>
      activitiesApi.create({ title, categoryId }),
    onSuccess: (activity) => {
      qc.invalidateQueries({ queryKey: ['activities'] })
      setForm((f) => ({ ...f, activityId: activity.id }))
      setShowNewActivity(false)
      setNewActivityTitle('')
      setNewActivityCategoryId('')
    },
  })

  const mutation = useMutation({
    mutationFn: () => {
      const windowDurationMinutes = useWindow
        ? (parseInt(form.windowDurationHours || '0') * 60) + parseInt(form.windowDurationMins || '0')
        : null
      const schedulePayload = {
        startAt: useWindow || isFloating ? null : toIso(form.startAt),
        endAt: useWindow || isAllDay || isFloating ? null : (useStartEnd ? toIso(form.endAt) : null),
        isAllDay: useWindow || isFloating ? false : isAllDay,
        windowStart: useWindow ? toIso(form.windowStart) : null,
        windowEnd: useWindow ? toIso(form.windowEnd) : null,
        windowDurationMinutes: useWindow ? windowDurationMinutes : null,
      }

      if (kind === 'event') {
        const eventPayload = {
          title: form.title.trim(),
          categoryId: form.categoryId || null,
          goalId: form.goalId || null,
          ...schedulePayload,
        }
        return isEdit
          ? occurrencesApi.updateEvent(occurrence!.id, eventPayload)
          : occurrencesApi.createEvent(eventPayload)
      }

      const occurrencePayload = {
        activityId: form.activityId,
        title: form.title.trim() || null,
        ...schedulePayload,
      }
      return isEdit
        ? occurrencesApi.update(occurrence!.id, occurrencePayload)
        : occurrencesApi.create(occurrencePayload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
      onClose()
    },
  })

  function handleSubmit() {
    const errs = validate(form, kind, useStartEnd, useWindow)
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

  function enableFloating() {
    setIsFloating(true)
    setUseWindow(false)
    setUseStartEnd(false)
    setIsAllDay(false)
    setForm((f) => ({ ...f, startAt: '', endAt: '', windowStart: '', windowEnd: '', windowDurationHours: '', windowDurationMins: '' }))
    setErrors({})
  }

  function switchMode(mode: ScheduleMode) {
    if (mode === 'floating') {
      enableFloating()
      return
    }
    setIsFloating(false)
    if (mode === 'due') {
      if (useWindow) disableWindow()
      if (useStartEnd) disableStartEnd()
    } else if (mode === 'scheduled') {
      enableStartEnd()
    } else {
      enableWindow()
    }
  }

  const scheduleMode: ScheduleMode = isFloating ? 'floating' : useWindow ? 'window' : useStartEnd ? 'scheduled' : 'due'

  const selectedActivity = activities.find((a) => a.id === form.activityId) ?? defaultActivity ?? null

  const segmentClass = (active: boolean) =>
    `flex-1 rounded-md py-2 text-xs font-medium transition-colors ${
      active
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground'
    }`

  const kindTitle = isEdit
    ? (kind === 'event' ? 'Edit Event' : 'Edit Occurrence')
    : (kind === 'event' ? 'New Event' : 'New Occurrence')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={scheduleOnly ? 'Schedule Occurrence' : kindTitle}
      footer={
        <>
          {!isEdit && (
            <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          )}
          <Button onClick={handleSubmit} loading={mutation.isPending}>
            {isEdit ? 'Save Changes' : 'Create'}
          </Button>
        </>
      }
    >
      {/* Kind picker — hidden in scheduleOnly or edit mode */}
      {!scheduleOnly && !isEdit && (
        <div className="grid grid-cols-2 gap-0.5 rounded-lg border border-border bg-muted p-0.5">
          <button
            type="button"
            onClick={() => { setKind('activity'); setErrors({}) }}
            className={segmentClass(kind === 'activity')}
          >
            Activity
          </button>
          <button
            type="button"
            onClick={() => { setKind('event'); setErrors({}) }}
            className={segmentClass(kind === 'event')}
          >
            Event
          </button>
        </div>
      )}

      {/* Event mode: title + category + optional goal */}
      {kind === 'event' && !scheduleOnly && (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">Title</label>
            <input
              type="text"
              placeholder="Event title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
              autoFocus
              className={`h-11 rounded-lg border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring ${errors.title ? 'border-destructive' : 'border-input'}`}
            />
            {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Category</label>
              <select
                value={form.categoryId}
                onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Goal <span className="font-normal text-muted-foreground">(optional)</span></label>
              <select
                value={form.goalId}
                onChange={(e) => setForm((f) => ({ ...f, goalId: e.target.value }))}
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">No goal</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>{g.title}</option>
                ))}
              </select>
            </div>
          </div>
        </>
      )}

      {/* Activity mode: activity picker + optional title override */}
      {kind === 'activity' && !scheduleOnly && (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">Activity</label>
            {isEdit ? (
              <div className="flex h-10 items-center rounded-lg border border-border bg-muted/40 px-3 text-sm text-foreground">
                {occurrence?.activity.title}
              </div>
            ) : (
              <>
                <select
                  value={form.activityId}
                  onChange={(e) => {
                    if (e.target.value === '__new__') {
                      setShowNewActivity(true)
                    } else {
                      setForm((f) => ({ ...f, activityId: e.target.value }))
                      setShowNewActivity(false)
                    }
                  }}
                  className={`h-10 w-full rounded-lg border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring ${errors.activityId ? 'border-destructive' : 'border-input'}`}
                >
                  <option value="">Select an activity...</option>
                  {activities.map((a) => (
                    <option key={a.id} value={a.id}>{a.title}{a.goal ? ` (${a.goal.title})` : ''}</option>
                  ))}
                  <option value="__new__">+ Create new activity</option>
                </select>
                {errors.activityId && <p className="text-xs text-destructive">{errors.activityId}</p>}
              </>
            )}

            {/* Inline new activity creation */}
            {showNewActivity && !isEdit && (
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3">
                <input
                  type="text"
                  placeholder="Activity name"
                  value={newActivityTitle}
                  onChange={(e) => setNewActivityTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newActivityTitle.trim()) createActivityMutation.mutate({ title: newActivityTitle.trim(), categoryId: newActivityCategoryId || null })
                    if (e.key === 'Escape') { setShowNewActivity(false); setNewActivityTitle(''); setNewActivityCategoryId('') }
                  }}
                  autoFocus
                  className="h-8 min-w-0 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <select
                  value={newActivityCategoryId}
                  onChange={(e) => setNewActivityCategoryId(e.target.value)}
                  className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">No category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => { if (newActivityTitle.trim()) createActivityMutation.mutate({ title: newActivityTitle.trim(), categoryId: newActivityCategoryId || null }) }}
                    loading={createActivityMutation.isPending}
                  >
                    Add
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { setShowNewActivity(false); setNewActivityTitle(''); setNewActivityCategoryId('') }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Selected activity context */}
            {selectedActivity && (selectedActivity.goal || selectedActivity.category) && (
              <div className="flex flex-wrap gap-2 px-1">
                {selectedActivity.goal && (
                  <span className="text-xs text-muted-foreground">Goal: {selectedActivity.goal.title}</span>
                )}
                {selectedActivity.category && (
                  <span className="text-xs text-muted-foreground">Category: {selectedActivity.category.name}</span>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">
              Title <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <input
              type="text"
              placeholder={selectedActivity ? selectedActivity.title : 'Override activity title...'}
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
              className="h-11 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </>
      )}

      {/* Scheduling section */}
      <div className="flex flex-col gap-3">
        {!scheduleOnly && (
          <div className="grid grid-cols-4 gap-0.5 rounded-lg border border-border bg-muted p-0.5">
            <button type="button" onClick={() => switchMode('due')} className={segmentClass(scheduleMode === 'due')}>Due</button>
            <button type="button" onClick={() => switchMode('scheduled')} className={segmentClass(scheduleMode === 'scheduled')}>Scheduled</button>
            <button type="button" onClick={() => switchMode('window')} className={segmentClass(scheduleMode === 'window')}>Window</button>
            <button type="button" onClick={() => switchMode('floating')} className={segmentClass(scheduleMode === 'floating')}>Floating</button>
          </div>
        )}

        {scheduleMode === 'due' && !scheduleOnly && (
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

        {(scheduleMode === 'scheduled' || scheduleOnly) && (
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

      {mutation.error instanceof Error && (
        <p className="text-sm text-destructive">{mutation.error.message}</p>
      )}
    </Modal>
  )
}
