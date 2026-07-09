import { useEffect, useRef, useState } from 'react'
import { Plus, X, Check } from 'lucide-react'
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
  const [baseEventSearch, setBaseEventSearch] = useState('')
  const [showBaseEventResults, setShowBaseEventResults] = useState(false)
  const [showLinkSearch, setShowLinkSearch] = useState(false)
  const [linkedBaseEvent, setLinkedBaseEvent] = useState<BaseEventSummary | null>(() =>
    defaultBaseEvent && !event ? defaultBaseEvent : null,
  )
  const searchRef = useRef<HTMLDivElement>(null)
  const [showGoalPicker, setShowGoalPicker] = useState(false)
  const [goalSearch, setGoalSearch] = useState('')
  const [showCatPicker, setShowCatPicker] = useState(false)
  const [catSearch, setCatSearch] = useState('')

  useEffect(() => {
    if (open) {
      setBaseEventSearch('')
      setShowBaseEventResults(false)
      setShowLinkSearch(false)
      setErrors({})
      setShowGoalPicker(false)
      setGoalSearch('')
      setShowCatPicker(false)
      setCatSearch('')
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
              <button
                type="button"
                onClick={() => { setShowGoalPicker((v) => !v); setGoalSearch('') }}
                aria-label="Add goal"
                className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${showGoalPicker ? 'border-primary/50 bg-primary/10 text-primary' : 'border-dashed border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'}`}
              >
                <Plus className="h-4 w-4" />
              </button>
            )}
          </div>
          {showGoalPicker && (
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="border-b border-border px-3 py-2">
                <input
                  type="text"
                  placeholder="Search goals..."
                  value={goalSearch}
                  onChange={(e) => setGoalSearch(e.target.value)}
                  autoFocus
                  className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
              <div className="max-h-40 overflow-y-auto">
                {activeGoals
                  .filter((g) => !form.goalIds.includes(g.id) && g.title.toLowerCase().includes(goalSearch.toLowerCase()))
                  .map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => toggleGoal(g.id)}
                      className="w-full px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
                    >
                      {g.title}
                    </button>
                  ))}
                {activeGoals.filter((g) => !form.goalIds.includes(g.id) && g.title.toLowerCase().includes(goalSearch.toLowerCase())).length === 0 && (
                  <p className="px-3 py-2.5 text-sm text-muted-foreground">No goals found.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Category */}
      {categories.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Category</span>
          <div className="flex flex-wrap items-center gap-2">
            {(() => {
              const cat = categories.find((c) => c.id === form.categoryId)
              if (!cat) return null
              return (
                <span className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium" style={{ borderColor: cat.color, backgroundColor: cat.color + '22', color: cat.color }}>
                  <CategoryIcon icon={cat.icon} color={cat.color} size={13} strokeWidth={2} />
                  {cat.name}
                  <button
                    type="button"
                    onClick={() => { setForm((f) => ({ ...f, categoryId: null })); setShowCatPicker(false) }}
                    aria-label="Remove category"
                    className="ml-0.5 opacity-60 transition-opacity hover:opacity-100"
                    style={{ color: cat.color }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )
            })()}
            <button
              type="button"
              onClick={() => { setShowCatPicker((v) => !v); setCatSearch('') }}
              aria-label={form.categoryId ? 'Change category' : 'Add category'}
              className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${showCatPicker ? 'border-primary/50 bg-primary/10 text-primary' : 'border-dashed border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'}`}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          {showCatPicker && (
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="border-b border-border px-3 py-2">
                <input
                  type="text"
                  placeholder="Search categories..."
                  value={catSearch}
                  onChange={(e) => setCatSearch(e.target.value)}
                  autoFocus
                  className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
              <div className="max-h-40 overflow-y-auto">
                {categories
                  .filter((c) => c.name.toLowerCase().includes(catSearch.toLowerCase()))
                  .map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => { setForm((f) => ({ ...f, categoryId: cat.id })); setShowCatPicker(false); setCatSearch('') }}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
                    >
                      <CategoryIcon icon={cat.icon} color={cat.color} size={14} strokeWidth={2} />
                      {cat.name}
                      {form.categoryId === cat.id && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
                    </button>
                  ))}
                {categories.filter((c) => c.name.toLowerCase().includes(catSearch.toLowerCase())).length === 0 && (
                  <p className="px-3 py-2.5 text-sm text-muted-foreground">No categories found.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Link to base event (create only) */}
      {!isEdit && (
        <div className="flex flex-col gap-1.5" ref={searchRef}>
          {linkedBaseEvent ? (
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Linked pattern</span>
                <span className="truncate text-sm font-medium text-foreground">{linkedBaseEvent.title}</span>
              </div>
              <button
                type="button"
                onClick={clearBaseEvent}
                className="ml-3 shrink-0 text-xs text-muted-foreground transition-colors hover:text-destructive"
              >
                Remove
              </button>
            </div>
          ) : showLinkSearch ? (
            <div className="relative">
              <input
                type="text"
                placeholder="Search event patterns..."
                value={baseEventSearch}
                onChange={(e) => { setBaseEventSearch(e.target.value); setShowBaseEventResults(true) }}
                onFocus={() => setShowBaseEventResults(true)}
                onBlur={() => setTimeout(() => { setShowBaseEventResults(false); setShowLinkSearch(false) }, 150)}
                autoFocus
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
              {showBaseEventResults && baseEventResults.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-card shadow-pop">
                  {baseEventResults.map((be) => (
                    <li key={be.id}>
                      <button
                        type="button"
                        onMouseDown={() => selectBaseEvent(be)}
                        className="w-full px-3 py-3 text-left text-sm text-foreground hover:bg-muted/60"
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
              className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            >
              <span className="text-base leading-none font-medium">+</span>
              Link to existing event pattern
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
