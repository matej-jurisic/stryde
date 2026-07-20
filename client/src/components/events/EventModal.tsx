import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2, Plus } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Select } from '@/components/ui/Select'
import { DateTimePicker } from '@/components/ui/DateTimePicker'
import { occurrencesApi, activitiesApi, categoriesApi, goalsApi } from '@/lib/api'
import { toastError } from '@/store/toasts'
import type { Activity, ActivityKind, Occurrence } from '@/lib/types'

// Draft subtask row: id present = existing subtask, absent = added in this edit session.
interface DraftSubtask {
  id?: string
  title: string
}

interface FormState {
  activityId: string
  title: string
  categoryId: string
  goalId: string
  startAt: string
  endAt: string
  durationHours: string
  durationMins: string
}

interface Errors {
  activityId?: string
  title?: string
  endAt?: string
  duration?: string
}

type TimeMode = 'due' | 'scheduled' | 'floating'

function validate(form: FormState, kind: ActivityKind, timeMode: TimeMode, isPlanned: boolean, isAllDay: boolean): Errors {
  const errs: Errors = {}
  if (kind === 'activity' && !form.activityId) errs.activityId = 'Please select an activity.'
  if (kind === 'event' && !form.title.trim()) errs.title = 'Title is required.'
  if (timeMode === 'scheduled' && !isAllDay && form.startAt && form.endAt && form.endAt <= form.startAt) {
    errs.endAt = 'End time must be after start time.'
  }
  if (timeMode === 'scheduled' && isAllDay && form.startAt && form.endAt && form.endAt.substring(0, 10) < form.startAt.substring(0, 10)) {
    errs.endAt = 'End date must be on or after the start date.'
  }
  if (form.durationHours || form.durationMins) {
    const totalMins = (parseInt(form.durationHours || '0') * 60) + parseInt(form.durationMins || '0')
    if (isPlanned && timeMode === 'scheduled' && form.startAt && form.endAt) {
      const windowMins = (new Date(form.endAt).getTime() - new Date(form.startAt).getTime()) / 60000
      if (totalMins > windowMins) errs.duration = 'Duration cannot exceed the length of the window.'
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

function addMinutes(dtLocal: string, minutes: number): string {
  if (!dtLocal) return ''
  const d = new Date(dtLocal)
  d.setMinutes(d.getMinutes() + minutes)
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`
}

function addOneHour(dtLocal: string): string {
  return addMinutes(dtLocal, 60)
}

function toAllDayEndInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  d.setDate(d.getDate() - 1)
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}

function toAllDayExclusiveEndIso(displayDate: string): string {
  const d = new Date(displayDate + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  return d.toISOString()
}

function durationToHM(minutes: number | null): { h: string; m: string } {
  if (!minutes) return { h: '', m: '' }
  return { h: String(Math.floor(minutes / 60)), m: String(minutes % 60) }
}

interface OccurrenceModalProps {
  open: boolean
  onClose: () => void
  occurrence?: Occurrence
  duplicateFrom?: Occurrence
  focusStartAt?: boolean
  defaultStartAt?: string
  defaultEndAt?: string
  defaultActivity?: Activity
  scheduleOnly?: boolean
}

export function EventModal({ open, onClose, occurrence, duplicateFrom, focusStartAt, defaultStartAt, defaultEndAt, defaultActivity, scheduleOnly }: OccurrenceModalProps) {
  const qc = useQueryClient()
  const isEdit = Boolean(occurrence)

  const source = occurrence ?? duplicateFrom

  const dur = durationToHM(source?.durationMinutes ?? null)
  const isEventKind = source?.activity.kind === 'event'

  const [kind, setKind] = useState<ActivityKind>(() => isEventKind ? 'event' : 'activity')

  const [form, setForm] = useState<FormState>(() => ({
    activityId: source?.activityId ?? defaultActivity?.id ?? '',
    title: isEventKind ? (source?.activity.title ?? '') : (occurrence?.title ?? duplicateFrom?.title ?? ''),
    categoryId: source?.activity.categoryId ?? '',
    goalId: source?.activity.goalId ?? '',
    startAt: occurrence ? (toInputValue(occurrence.startAt) || (scheduleOnly ? todayLocal() : '')) : (duplicateFrom ? toInputValue(duplicateFrom.startAt) : (defaultStartAt ?? todayLocal())),
    endAt: source?.isAllDay && source?.endAt
      ? toAllDayEndInput(source.endAt)
      : (occurrence ? toInputValue(occurrence.endAt) : (duplicateFrom ? toInputValue(duplicateFrom.endAt) : (defaultEndAt ?? ''))),
    durationHours: dur.h,
    durationMins: dur.m,
  }))

  const [errors, setErrors] = useState<Errors>({})
  const [isAllDay, setIsAllDay] = useState(() => source?.isAllDay ?? false)
  const [isPlanned, setIsPlanned] = useState(() => scheduleOnly ? false : (source?.isPlanned ?? false))
  const [timeMode, setTimeMode] = useState<TimeMode>(() => {
    if (scheduleOnly) {
      if (occurrence!.startAt && occurrence!.endAt) return 'scheduled'
      return 'due'
    }
    if (source) {
      if (!source.startAt && !source.endAt && !source.isAllDay) return 'floating'
      if (source.startAt && source.endAt) return 'scheduled'
      return 'due'
    }
    return defaultEndAt ? 'scheduled' : 'due'
  })

  const [showAdvanced, setShowAdvanced] = useState(() => {
    if (isEdit || scheduleOnly) return true
    if (!source) return false
    if (source.durationMinutes) return true
    if (source.title) return true
    if (source.activity?.categoryId || source.activity?.goalId) return true
    return false
  })

  const [showNewActivity, setShowNewActivity] = useState(false)
  const [newActivityTitle, setNewActivityTitle] = useState('')
  const [newActivityCategoryId, setNewActivityCategoryId] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [subtasks, setSubtasks] = useState<DraftSubtask[]>(
    () => (occurrence?.subtasks ?? []).map((s) => ({ id: s.id, title: s.title })),
  )
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')

  useEffect(() => {
    if (open) {
      setSubtasks((occurrence?.subtasks ?? []).map((s) => ({ id: s.id, title: s.title })))
      setNewSubtaskTitle('')
    }
  }, [open, occurrence?.id])

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
      const durationMinutes = (form.durationHours || form.durationMins)
        ? (parseInt(form.durationHours || '0') * 60) + parseInt(form.durationMins || '0')
        : null

      const schedulePayload = {
        startAt: timeMode === 'floating' ? null : toIso(form.startAt),
        endAt: isAllDay
          ? (form.endAt ? toAllDayExclusiveEndIso(form.endAt.substring(0, 10)) : null)
          : (timeMode !== 'scheduled' ? null : toIso(form.endAt)),
        isAllDay: timeMode === 'floating' ? false : isAllDay,
        isPlanned,
        durationMinutes,
        // Subtasks are edited as a draft and applied here; omitted when the section
        // is not shown so the server leaves them untouched.
        subtasks: isEdit && !scheduleOnly
          ? subtasks.map((s) => ({ id: s.id ?? null, title: s.title }))
          : undefined,
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

  const deleteMutation = useMutation({
    mutationFn: () => occurrencesApi.delete(occurrence!.id),
    onSuccess: () => {
      setConfirmDelete(false)
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
      onClose()
    },
    onError: (err) => toastError(err, 'Could not delete the occurrence.'),
  })

  function addSubtask() {
    const title = newSubtaskTitle.trim()
    if (!title) return
    setSubtasks((prev) => [...prev, { title }])
    setNewSubtaskTitle('')
  }

  function removeSubtask(index: number) {
    setSubtasks((prev) => prev.filter((_, i) => i !== index))
  }

  function handleSubmit() {
    const errs = validate(form, kind, timeMode, isPlanned, isAllDay)
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }
    mutation.mutate()
  }

  function switchMode(mode: TimeMode) {
    setTimeMode(mode)
    if (mode === 'floating') {
      setIsAllDay(false)
      setForm((f) => ({ ...f, startAt: '', endAt: '', durationHours: '', durationMins: '' }))
      setErrors({})
    } else if (mode === 'scheduled') {
      if (!form.endAt && form.startAt && !isAllDay) {
        const durationMins = (parseInt(form.durationHours || '0') * 60) + parseInt(form.durationMins || '0')
        setForm((f) => ({ ...f, endAt: durationMins > 0 ? addMinutes(f.startAt, durationMins) : addOneHour(f.startAt) }))
      }
      setErrors({})
    } else {
      setForm((f) => ({ ...f, endAt: '' }))
      setErrors((e) => ({ ...e, endAt: undefined }))
    }
  }

  function toggleAllDay() {
    if (!isAllDay) {
      const dateOnly = form.startAt ? form.startAt.substring(0, 10) : ''
      setForm((f) => ({ ...f, startAt: dateOnly ? dateOnly + 'T00:00' : '', endAt: '' }))
      setErrors((e) => ({ ...e, endAt: undefined }))
    }
    setIsAllDay((v) => !v)
  }

  function setEndOfDay() {
    const existing = form.startAt ? form.startAt.substring(0, 10) : ''
    const d = new Date()
    const z = (n: number) => String(n).padStart(2, '0')
    const today = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
    const date = existing || today
    setIsAllDay(false)
    setTimeMode('due')
    setForm((f) => ({ ...f, startAt: date + 'T23:59', endAt: '' }))
    setErrors({})
  }

  const selectedActivity = activities.find((a) => a.id === form.activityId) ?? defaultActivity ?? duplicateFrom?.activity ?? null

  const segmentClass = (active: boolean) =>
    `flex-1 rounded-md py-2 text-xs font-medium transition-colors ${
      active
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground'
    }`

  const kindTitle = isEdit
    ? (kind === 'event' ? 'Edit Event' : 'Edit Occurrence')
    : (kind === 'event' ? 'New Event' : 'New Occurrence')

  const showDuration = !scheduleOnly

  const allDayButton = (
    <button
      type="button"
      onClick={toggleAllDay}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        isAllDay
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border bg-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground'
      }`}
    >
      Date only
    </button>
  )

  const endOfDayButton = (
    <button
      type="button"
      onClick={setEndOfDay}
      className="rounded-full border border-border bg-transparent px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
    >
      End of day
    </button>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={scheduleOnly ? 'Schedule Occurrence' : kindTitle}
      footer={
        <>
          {isEdit && !scheduleOnly && (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={mutation.isPending || deleteMutation.isPending}
              aria-label="Delete"
              className="mr-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" strokeWidth={2} />
            </button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending || deleteMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={mutation.isPending} disabled={deleteMutation.isPending}>
            {isEdit ? 'Save Changes' : 'Create'}
          </Button>
        </>
      }
    >
      {/* Primary field row: activity select or event title, with kind picker on the right */}
      {!scheduleOnly && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-end gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              {kind === 'event' ? (
                <>
                  <label className="text-sm font-medium text-foreground">Title</label>
                  <input
                    type="text"
                    placeholder="Event title"
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
                    autoFocus
                    className={`h-10 rounded-lg border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring ${errors.title ? 'border-destructive' : 'border-input'}`}
                  />
                </>
              ) : (
                <>
                  <label className="text-sm font-medium text-foreground">Activity</label>
                  {isEdit ? (
                    <div className="flex h-10 items-center rounded-lg border border-border bg-muted/40 px-3 text-sm text-foreground">
                      {occurrence?.activity.title}
                    </div>
                  ) : (
                    <Select
                      value={form.activityId}
                      onChange={(v) => {
                        setForm((f) => ({ ...f, activityId: v }))
                        setShowNewActivity(false)
                      }}
                      options={activities.map((a) => ({
                        value: a.id,
                        label: a.title,
                        sublabel: a.goal?.title,
                      }))}
                      placeholder="Select an activity..."
                      error={Boolean(errors.activityId)}
                      onCreateNew={() => setShowNewActivity(true)}
                      createNewLabel="+ Create new activity"
                    />
                  )}
                </>
              )}
            </div>

            {!isEdit && (
              <div className="flex shrink-0 flex-col gap-1.5">
                <span className="invisible text-sm font-medium">T</span>
                <div className="flex h-10 gap-0.5 rounded-lg border border-border bg-muted p-0.5">
                  <button
                    type="button"
                    onClick={() => { setKind('activity'); setErrors({}) }}
                    className={`flex flex-1 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors ${kind === 'activity' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    Activity
                  </button>
                  <button
                    type="button"
                    onClick={() => { setKind('event'); setErrors({}) }}
                    className={`flex flex-1 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors ${kind === 'event' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    Event
                  </button>
                </div>
              </div>
            )}
          </div>

          {kind === 'event' && errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
          {kind === 'activity' && errors.activityId && <p className="text-xs text-destructive">{errors.activityId}</p>}

          {kind === 'activity' && showNewActivity && !isEdit && (
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
              <Select
                value={newActivityCategoryId}
                onChange={setNewActivityCategoryId}
                options={[
                  { value: '', label: 'No category' },
                  ...categories.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
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

          {kind === 'activity' && selectedActivity && (selectedActivity.goal || selectedActivity.category) && (
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
      )}

      {/* Scheduling (When) */}
      {!scheduleOnly && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-0.5 rounded-lg border border-border bg-muted p-0.5">
            <button type="button" onClick={() => switchMode('due')} className={segmentClass(timeMode === 'due')}>Due</button>
            <button type="button" onClick={() => switchMode('scheduled')} className={segmentClass(timeMode === 'scheduled')}>Scheduled</button>
            <button type="button" onClick={() => switchMode('floating')} className={segmentClass(timeMode === 'floating')}>Floating</button>
          </div>

          {timeMode === 'due' && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground">Due date</label>
                <div className="flex gap-1.5">{allDayButton}{endOfDayButton}</div>
              </div>
              <DateTimePicker
                value={form.startAt}
                onChange={(v) => setForm((f) => ({ ...f, startAt: v }))}
                mode={isAllDay ? 'date' : 'datetime'}
                autoFocus={focusStartAt}
              />
            </div>
          )}

          {timeMode === 'scheduled' && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">{isPlanned ? 'Window start' : 'Start'}</label>
                  {allDayButton}
                </div>
                <DateTimePicker
                  value={form.startAt}
                  onChange={(v) => setForm((f) => ({ ...f, startAt: v }))}
                  mode={isAllDay ? 'date' : 'datetime'}
                  autoFocus={focusStartAt}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">
                  {isAllDay ? 'End date' : (isPlanned ? 'Window end' : 'End')}
                </label>
                <DateTimePicker
                  value={form.endAt}
                  onChange={(v) => setForm((f) => ({ ...f, endAt: v }))}
                  mode={isAllDay ? 'date' : 'datetime'}
                  error={Boolean(errors.endAt)}
                />
                {errors.endAt && <p className="text-xs text-destructive">{errors.endAt}</p>}
              </div>
            </div>
          )}

          {timeMode === 'floating' && (
            <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground">
              No date - floats freely in your plan
            </p>
          )}

          {timeMode !== 'floating' && (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={isPlanned}
                onChange={(e) => setIsPlanned(e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              Planned
            </label>
          )}
        </div>
      )}

      {/* scheduleOnly: full scheduling controls */}
      {scheduleOnly && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-0.5 rounded-lg border border-border bg-muted p-0.5">
            <button type="button" onClick={() => switchMode('due')} className={segmentClass(timeMode === 'due')}>Due</button>
            <button type="button" onClick={() => switchMode('scheduled')} className={segmentClass(timeMode === 'scheduled')}>Scheduled</button>
          </div>

          {timeMode === 'due' && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground">Date</label>
                <div className="flex gap-1.5">{allDayButton}{endOfDayButton}</div>
              </div>
              <DateTimePicker
                value={form.startAt}
                onChange={(v) => setForm((f) => ({ ...f, startAt: v }))}
                mode={isAllDay ? 'date' : 'datetime'}
                autoFocus={focusStartAt}
              />
            </div>
          )}

          {timeMode === 'scheduled' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">Window start</label>
                <DateTimePicker
                  value={form.startAt}
                  onChange={(v) => setForm((f) => ({ ...f, startAt: v }))}
                  autoFocus={focusStartAt}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">Window end</label>
                <DateTimePicker
                  value={form.endAt}
                  onChange={(v) => setForm((f) => ({ ...f, endAt: v }))}
                  error={Boolean(errors.endAt)}
                />
                {errors.endAt && <p className="text-xs text-destructive">{errors.endAt}</p>}
              </div>
            </div>
          )}

          {timeMode !== 'floating' && (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={isPlanned}
                onChange={(e) => setIsPlanned(e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              Keep as planned
            </label>
          )}
        </div>
      )}

      {/* More options toggle */}
      {!scheduleOnly && (
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1.5 self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <svg
            className={`h-3 w-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
          {showAdvanced ? 'Fewer options' : 'More options'}
        </button>
      )}

      {/* Details */}
      {!scheduleOnly && showAdvanced && (
        <div className="flex flex-col gap-3">
          {/* Duration */}
          {showDuration && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">
                Duration <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex h-9 items-center gap-2 rounded-lg border border-input bg-background px-3">
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={form.durationHours}
                    onChange={(e) => setForm((f) => ({ ...f, durationHours: e.target.value }))}
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
                    value={form.durationMins}
                    onChange={(e) => setForm((f) => ({ ...f, durationMins: e.target.value }))}
                    className="min-w-0 flex-1 bg-transparent text-sm text-foreground focus:outline-none"
                  />
                  <span className="shrink-0 text-sm text-muted-foreground">min</span>
                </div>
              </div>
              {errors.duration && <p className="text-xs text-destructive">{errors.duration}</p>}
            </div>
          )}

          {/* Activity: title override */}
          {kind === 'activity' && (
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
          )}

          {/* Event: category + goal */}
          {kind === 'event' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">Category</label>
                <Select
                  value={form.categoryId}
                  onChange={(v) => setForm((f) => ({ ...f, categoryId: v }))}
                  options={[
                    { value: '', label: 'No category' },
                    ...categories.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">
                  Goal <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <Select
                  value={form.goalId}
                  onChange={(v) => setForm((f) => ({ ...f, goalId: v }))}
                  options={[
                    { value: '', label: 'No goal' },
                    ...goals.map((g) => ({ value: g.id, label: g.title })),
                  ]}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {isEdit && !scheduleOnly && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subtasks</span>
          {subtasks.length > 0 && (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {subtasks.map((s, i) => (
                <li key={s.id ?? `new-${i}`} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="flex-1 text-sm text-foreground">{s.title}</span>
                  <button
                    type="button"
                    onClick={() => removeSubtask(i)}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input
              value={newSubtaskTitle}
              onChange={(e) => setNewSubtaskTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSubtask() } }}
              placeholder="Add subtask..."
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <Button
              type="button"
              size="sm"
              onClick={addSubtask}
              disabled={!newSubtaskTitle.trim()}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {mutation.error instanceof Error && (
        <p className="text-sm text-destructive">{mutation.error.message}</p>
      )}

      {isEdit && (
        <ConfirmDialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => deleteMutation.mutate()}
          loading={deleteMutation.isPending}
          title="Delete occurrence?"
          message={`"${occurrence!.effectiveTitle}" will be permanently deleted. This cannot be undone.`}
        />
      )}
    </Modal>
  )
}
