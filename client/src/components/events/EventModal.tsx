import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { occurrencesApi, activitiesApi } from '@/lib/api'
import type { Activity, Occurrence } from '@/lib/types'

interface FormState {
  activityId: string
  title: string
  startAt: string
  endAt: string
  windowStart: string
  windowEnd: string
  windowDurationHours: string
  windowDurationMins: string
}

interface Errors {
  activityId?: string
  endAt?: string
  windowEnd?: string
  windowDuration?: string
}

function validate(form: FormState, useStartEnd: boolean, useWindow: boolean): Errors {
  const errs: Errors = {}
  if (!form.activityId) errs.activityId = 'Please select an activity.'
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
}

type ScheduleMode = 'due' | 'scheduled' | 'window'

export function EventModal({ open, onClose, occurrence, focusStartAt, defaultStartAt, defaultEndAt, defaultActivity, defaultMode }: OccurrenceModalProps) {
  const qc = useQueryClient()
  const isEdit = Boolean(occurrence)

  const dur = durationToHM(occurrence?.windowDurationMinutes ?? null)

  const [form, setForm] = useState<FormState>(() => ({
    activityId: occurrence?.activityId ?? defaultActivity?.id ?? '',
    title: occurrence?.title ?? '',
    startAt: occurrence
      ? (defaultMode === 'scheduled' && !occurrence.startAt && occurrence.windowStart
          ? toInputValue(occurrence.windowStart)
          : toInputValue(occurrence.startAt))
      : (defaultStartAt ?? ''),
    endAt: occurrence ? toInputValue(occurrence.endAt) : (defaultEndAt ?? ''),
    windowStart: occurrence ? toInputValue(occurrence.windowStart) : '',
    windowEnd: occurrence ? toInputValue(occurrence.windowEnd) : '',
    windowDurationHours: dur.h,
    windowDurationMins: dur.m,
  }))

  const [errors, setErrors] = useState<Errors>({})
  const [isAllDay, setIsAllDay] = useState(() => occurrence?.isAllDay ?? false)
  const [useStartEnd, setUseStartEnd] = useState(() => {
    if (defaultMode) return defaultMode === 'scheduled'
    return occurrence ? Boolean(occurrence.endAt) : Boolean(defaultEndAt)
  })
  const [useWindow, setUseWindow] = useState(() => {
    if (defaultMode) return defaultMode === 'window'
    return Boolean(occurrence?.windowStart)
  })

  // New activity inline creation
  const [showNewActivity, setShowNewActivity] = useState(false)
  const [newActivityTitle, setNewActivityTitle] = useState('')

  useEffect(() => {
    if (open) setErrors({})
  }, [open])

  const { data: activities = [] } = useQuery({
    queryKey: ['activities'],
    queryFn: () => activitiesApi.list(),
    enabled: open,
  })


  const createActivityMutation = useMutation({
    mutationFn: (title: string) => activitiesApi.create({ title }),
    onSuccess: (activity) => {
      qc.invalidateQueries({ queryKey: ['activities'] })
      setForm((f) => ({ ...f, activityId: activity.id }))
      setShowNewActivity(false)
      setNewActivityTitle('')
    },
  })

  const mutation = useMutation({
    mutationFn: () => {
      const windowDurationMinutes = useWindow
        ? (parseInt(form.windowDurationHours || '0') * 60) + parseInt(form.windowDurationMins || '0')
        : null
      const payload = {
        activityId: form.activityId,
        title: form.title.trim() || null,
        startAt: useWindow ? null : toIso(form.startAt),
        endAt: useWindow || isAllDay ? null : (useStartEnd ? toIso(form.endAt) : null),
        isAllDay: useWindow ? false : isAllDay,
        windowStart: useWindow ? toIso(form.windowStart) : null,
        windowEnd: useWindow ? toIso(form.windowEnd) : null,
        windowDurationMinutes: useWindow ? windowDurationMinutes : null,
      }
      return isEdit
        ? occurrencesApi.update(occurrence!.id, payload)
        : occurrencesApi.create(payload)
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

  const selectedActivity = activities.find((a) => a.id === form.activityId) ?? defaultActivity ?? null

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
      title={isEdit ? 'Edit Occurrence' : 'New Occurrence'}
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
      {/* Activity picker */}
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
          <div className="flex gap-2 rounded-lg border border-border bg-muted/40 p-3">
            <input
              type="text"
              placeholder="Activity name"
              value={newActivityTitle}
              onChange={(e) => setNewActivityTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newActivityTitle.trim()) createActivityMutation.mutate(newActivityTitle.trim())
                if (e.key === 'Escape') { setShowNewActivity(false); setNewActivityTitle('') }
              }}
              autoFocus
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <Button
              size="sm"
              onClick={() => { if (newActivityTitle.trim()) createActivityMutation.mutate(newActivityTitle.trim()) }}
              loading={createActivityMutation.isPending}
            >
              Add
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setShowNewActivity(false); setNewActivityTitle('') }}
            >
              Cancel
            </Button>
          </div>
        )}

        {/* Show selected activity's goal/category as read-only context */}
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

      {/* Optional title override */}
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

      {/* Scheduling section */}
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-0.5 rounded-lg border border-border bg-muted p-0.5">
          <button type="button" onClick={() => switchMode('due')} className={segmentClass(scheduleMode === 'due')}>Due date</button>
          <button type="button" onClick={() => switchMode('scheduled')} className={segmentClass(scheduleMode === 'scheduled')}>Scheduled</button>
          <button type="button" onClick={() => switchMode('window')} className={segmentClass(scheduleMode === 'window')}>Window</button>
        </div>

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
