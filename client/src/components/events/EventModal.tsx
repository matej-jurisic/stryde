import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { eventsApi, goalsApi, categoriesApi, baseEventsApi } from '@/lib/api'
import type { BaseEventSummary, Event } from '@/lib/types'
import { CategoryIcon } from '@/components/categories/categoryIcons'

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
      goalIds: defaultBaseEvent.goals.map((g) => g.id),
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
  const [baseEventSearch, setBaseEventSearch] = useState('')
  const [showBaseEventResults, setShowBaseEventResults] = useState(false)
  const [showLinkSearch, setShowLinkSearch] = useState(false)
  const [linkedBaseEvent, setLinkedBaseEvent] = useState<BaseEventSummary | null>(() =>
    defaultBaseEvent && !event ? defaultBaseEvent : null,
  )
  const searchRef = useRef<HTMLDivElement>(null)

  // Reset auxiliary UI state when the modal re-opens for the same event
  useEffect(() => {
    if (open) {
      setBaseEventSearch('')
      setShowBaseEventResults(false)
      setShowLinkSearch(false)
      setErrors({})
    }
  }, [open])

  const { data: goals = [] } = useQuery({
    queryKey: ['goals'],
    queryFn: () => goalsApi.list(),
    enabled: open,
  })

  const { data: baseEventResults = [] } = useQuery({
    queryKey: ['base-events', 'search', baseEventSearch],
    queryFn: () => baseEventsApi.search(baseEventSearch || undefined),
    enabled: open && showBaseEventResults,
    staleTime: 10 * 1000,
  })

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

  const deleteMutation = useMutation({
    mutationFn: () => eventsApi.delete(event!.id),
    onSuccess: () => {
      // Remove the event from every cached events list synchronously so the
      // calendar doesn't flash the deletion through the translucent backdrop.
      qc.setQueriesData<Event[]>({ queryKey: ['events'] }, (old) =>
        old ? old.filter((e) => e.id !== event!.id) : old,
      )
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
    setForm((f) => ({ ...f, endAt: '' }))
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
      goalIds: be.goals.map((g) => g.id),
      categoryId: be.category?.id ?? null,
      baseEventId: be.id,
    }))
    setBaseEventSearch('')
    setShowBaseEventResults(false)
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

  const activeGoals = goals.filter((g) => g.status !== 'closed')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Event' : 'New Event'}
      footer={
        <>
          {isEdit && (
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              loading={deleteMutation.isPending}
              disabled={mutation.isPending}
              className="mr-auto"
            >
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending || deleteMutation.isPending}>Cancel</Button>
          <Button onClick={handleSubmit} loading={mutation.isPending} disabled={deleteMutation.isPending}>
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

      {useWindow ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">Flexible window</span>
            <button type="button" onClick={disableWindow} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Use due date</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-foreground">Duration</label>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={form.windowDurationHours}
                  onChange={(e) => setForm((f) => ({ ...f, windowDurationHours: e.target.value }))}
                  className="h-9 w-16 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <span className="text-sm text-muted-foreground">h</span>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="0"
                  max="59"
                  placeholder="0"
                  value={form.windowDurationMins}
                  onChange={(e) => setForm((f) => ({ ...f, windowDurationMins: e.target.value }))}
                  className="h-9 w-16 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <span className="text-sm text-muted-foreground">min</span>
              </div>
            </div>
            {errors.windowDuration && <p className="text-xs text-destructive">{errors.windowDuration}</p>}
          </div>
        </div>
      ) : !useStartEnd ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="due-date" className="text-sm font-medium text-foreground">Due date</label>
            <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={isAllDay}
                onChange={toggleAllDay}
                className="h-3.5 w-3.5 rounded border-border accent-primary"
              />
              All day
            </label>
          </div>
          <input
            id="due-date"
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
            className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {!isAllDay && (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={enableStartEnd}
                className="self-start text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                + Set start and end time
              </button>
              <button
                type="button"
                onClick={enableWindow}
                className="self-start text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                + Set flexible window
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          <div className="flex gap-3">
            <button
              type="button"
              onClick={disableStartEnd}
              className="self-start text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Use due date only
            </button>
            <button
              type="button"
              onClick={enableWindow}
              className="self-start text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              + Set flexible window
            </button>
          </div>
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

      {categories.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-foreground">Category</span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, categoryId: null }))}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                form.categoryId === null
                  ? 'bg-muted border-foreground/30 text-foreground'
                  : 'bg-transparent border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'
              }`}
            >
              None
            </button>
            {categories.map((cat) => {
              const selected = form.categoryId === cat.id
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, categoryId: cat.id }))}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    selected
                      ? 'border-transparent text-foreground'
                      : 'bg-transparent border-border text-muted-foreground hover:text-foreground'
                  }`}
                  style={selected ? { backgroundColor: cat.color + '22', borderColor: cat.color } : undefined}
                >
                  <CategoryIcon icon={cat.icon} color={selected ? cat.color : 'currentColor'} size={11} strokeWidth={2} />
                  {cat.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {!isEdit && (
        <div className="flex flex-col gap-1.5" ref={searchRef}>
          {linkedBaseEvent ? (
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              <span className="text-foreground">Linked: <span className="font-medium">{linkedBaseEvent.title}</span></span>
              <button type="button" onClick={clearBaseEvent} className="text-xs text-muted-foreground hover:text-foreground">Remove</button>
            </div>
          ) : showLinkSearch ? (
            <div className="relative">
              <input
                type="text"
                placeholder="Search events..."
                value={baseEventSearch}
                onChange={(e) => { setBaseEventSearch(e.target.value); setShowBaseEventResults(true) }}
                onFocus={() => setShowBaseEventResults(true)}
                onBlur={() => setTimeout(() => { setShowBaseEventResults(false); setShowLinkSearch(false) }, 150)}
                autoFocus
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
              {showBaseEventResults && baseEventResults.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full rounded-md border border-border bg-card shadow-pop">
                  {baseEventResults.map((be) => (
                    <li key={be.id}>
                      <button
                        type="button"
                        onMouseDown={() => selectBaseEvent(be)}
                        className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted/60"
                      >
                        {be.title}
                        {be.goals.length > 0 && (
                          <span className="ml-2 text-xs text-muted-foreground">{be.goals[0].title}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowLinkSearch(true)}
              className="self-start text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              + Link to existing event
            </button>
          )}
        </div>
      )}

      {mutation.error instanceof Error && (
        <p className="text-sm text-destructive">{mutation.error.message}</p>
      )}
    </Modal>
  )
}
