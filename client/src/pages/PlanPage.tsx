import { useState, useMemo, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Menu, Plus, Check, X, Pencil, Trash2, CalendarPlus, MoreHorizontal } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { occurrencesApi, goalsApi, settingsApi } from '@/lib/api'
import type { Activity, Checkpoint, CheckpointSize, Occurrence, EventStatus, Goal } from '@/lib/types'
import { EventModal } from '@/components/events/EventModal'
import { RecommendationPanel } from '@/components/recommendations/RecommendationStrip'
import { Badge } from '@/components/ui/Badge'
import { CategoryIcon } from '@/components/categories/categoryIcons'

// ── helpers ────────────────────────────────────────────────────────────────

function sod(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  return r
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function formatDateInput(d: Date): string {
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}

function formatDayTitle(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatDayTitleCompact(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

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

function formatTimeRange(event: Occurrence): string {
  if (event.isAllDay) return 'All day'
  if (event.windowStart) {
    const range = event.windowEnd
      ? `${formatTime(event.windowStart)} - ${formatTime(event.windowEnd)}`
      : formatTime(event.windowStart)
    const dur = formatDuration(event.windowDurationMinutes)
    return dur ? `${range} ~${dur}` : range
  }
  if (!event.startAt) return ''
  if (event.endAt) return `${formatTime(event.startAt)} - ${formatTime(event.endAt)}`
  return formatTime(event.startAt)
}

const SIZE_WEIGHT: Record<CheckpointSize, number> = {
  tiny: 1, small: 2, normal: 3, big: 5, huge: 8,
}

function believedProgress(checkpoints: Checkpoint[]): number {
  const total = checkpoints.reduce((sum, c) => sum + SIZE_WEIGHT[c.size], 0)
  if (total === 0) return 0
  const reached = checkpoints
    .filter((c) => c.status === 'reached')
    .reduce((sum, c) => sum + SIZE_WEIGHT[c.size], 0)
  return (reached / total) * 100
}

// ── Goal health row ────────────────────────────────────────────────────────

function GoalHealthRow({ goal }: { goal: Goal }) {
  const progress = believedProgress(goal.checkpoints)
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="h-2 w-2 shrink-0 rounded-full bg-goal-focus" />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{goal.title}</span>
      <div className="w-28 shrink-0">
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-goal-focus transition-all"
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
      </div>
      <span className="w-9 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
        {Math.round(progress)}%
      </span>
    </div>
  )
}

// ── Agenda row ─────────────────────────────────────────────────────────────

const GOAL_TONE: Record<string, 'focus' | 'active' | 'bench' | 'neutral'> = {
  focus: 'focus',
  active: 'active',
  bench: 'bench',
  closed: 'neutral',
}

interface AgendaRowProps {
  event: Occurrence
  onEdit: () => void
  onSchedule?: () => void
}

function AgendaRow({ event, onEdit, onSchedule }: AgendaRowProps) {
  const qc = useQueryClient()
  const isPending = event.status === 'pending'
  const isDone = event.status === 'done'
  const isSkipped = event.status === 'skipped'
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [menuOpen])

  const statusMutation = useMutation({
    mutationFn: (status: EventStatus) => occurrencesApi.setStatus(event.id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => occurrencesApi.delete(event.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
    },
  })

  const timeRange = formatTimeRange(event)
  const cat = event.activity.category
  const goal = event.activity.goal

  return (
    <li className="group relative flex items-center gap-3 border-b border-border bg-card px-5 py-3 last:border-b-0 first:rounded-t-lg last:rounded-b-lg hover:bg-muted/40 transition-colors">
      {/* Status checkbox */}
      <button
        onClick={() => {
          if (isPending) statusMutation.mutate('done')
          else statusMutation.mutate('pending')
        }}
        title={isDone ? 'Mark pending' : isSkipped ? 'Mark pending' : 'Mark done'}
        className={[
          'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border transition-colors',
          isDone
            ? 'border-primary bg-primary text-primary-foreground'
            : isSkipped
              ? 'border-dashed border-muted-foreground text-muted-foreground'
              : 'border-border bg-background hover:border-primary',
        ].join(' ')}
      >
        {isDone && <Check className="h-3 w-3" strokeWidth={3} />}
        {isSkipped && <X className="h-3 w-3" strokeWidth={3} />}
      </button>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={`text-sm ${!isPending ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
            {event.effectiveTitle}
          </span>
          {goal && (
            <Badge tone={GOAL_TONE[goal.status] ?? 'neutral'}>{goal.title}</Badge>
          )}
        </div>
        {(timeRange || cat) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {timeRange && (
              <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{timeRange}</span>
            )}
            {cat && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <CategoryIcon icon={cat.icon} color={cat.color} size={11} strokeWidth={2} />
                {cat.name}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Actions menu */}
      <div ref={menuRef} className="shrink-0">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <MoreHorizontal className="h-4 w-4" strokeWidth={2} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full z-20 mt-1 min-w-[160px] rounded-lg border border-border bg-card py-1 shadow-pop">
            {isPending && (
              <button
                onClick={() => { statusMutation.mutate('skipped'); setMenuOpen(false) }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted transition-colors"
              >
                <X className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2.5} />
                Skip
              </button>
            )}
            {isPending && !event.startAt && onSchedule && (
              <button
                onClick={() => { onSchedule(); setMenuOpen(false) }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted transition-colors"
              >
                <CalendarPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
                Schedule
              </button>
            )}
            <button
              onClick={() => { onEdit(); setMenuOpen(false) }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted transition-colors"
            >
              <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
              Edit
            </button>
            <button
              onClick={() => { deleteMutation.mutate(); setMenuOpen(false) }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-destructive hover:bg-muted transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              Delete
            </button>
          </div>
        )}
      </div>
    </li>
  )
}

// ── PlanPage ───────────────────────────────────────────────────────────────

export function PlanPage() {
  const [current, setCurrent] = useState<Date>(() => sod(new Date()))
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingOccurrence, setEditingOccurrence] = useState<Occurrence | undefined>()
  const [defaultActivity, setDefaultActivity] = useState<Activity | undefined>()
  const [focusStartAt, setFocusStartAt] = useState(false)
  const [scheduleMode, setScheduleMode] = useState(false)
  const dateInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = dateInputRef.current
    if (!el) return
    const handler = (e: WheelEvent) => e.preventDefault()
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
    staleTime: 5 * 60 * 1000,
  })

  const effectiveToday = useMemo(() => {
    const boundary = settings?.dayBoundaryTime ?? '00:00'
    const now = new Date()
    const [h, m] = boundary.split(':').map(Number)
    const b = new Date(now)
    b.setHours(h, m, 0, 0)
    return now < b ? addDays(sod(now), -1) : sod(now)
  }, [settings?.dayBoundaryTime])

  const dayStart = sod(current)
  const dayEnd = addDays(dayStart, 1)
  const dateStr = formatDateInput(current)
  const isToday = isSameDay(current, effectiveToday)

  const { data: occurrences = [], isLoading: occurrencesLoading } = useQuery({
    queryKey: ['events', 'plan', dayStart.toISOString(), dayEnd.toISOString()],
    queryFn: () =>
      occurrencesApi.list({ startFrom: dayStart.toISOString(), endBefore: dayEnd.toISOString() }),
  })

  const { data: floatingOccurrences = [], isLoading: floatingLoading } = useQuery({
    queryKey: ['events', 'floating'],
    queryFn: () => occurrencesApi.list({ floating: true, status: 'pending' }),
  })

  const { data: focusGoals = [] } = useQuery({
    queryKey: ['goals', { status: 'focus' }],
    queryFn: () => goalsApi.list({ status: 'focus' }),
  })

  const scheduledEvents = useMemo(
    () =>
      occurrences
        .filter((o) => o.startAt !== null)
        .sort((a, b) => new Date(a.startAt!).getTime() - new Date(b.startAt!).getTime()),
    [occurrences],
  )

  const windowedEvents = useMemo(
    () => occurrences.filter((o) => o.startAt === null && o.windowStart !== null),
    [occurrences],
  )

  const isLoading = occurrencesLoading || floatingLoading

  function prev() { setCurrent((d) => addDays(d, -1)) }
  function next() { setCurrent((d) => addDays(d, 1)) }
  function goToday() { setCurrent(effectiveToday) }

  function openEdit(occurrence: Occurrence) {
    setDefaultActivity(undefined)
    setEditingOccurrence(occurrence)
    setFocusStartAt(false)
    setScheduleMode(false)
    setModalOpen(true)
  }

  function openSchedule(occurrence: Occurrence) {
    setDefaultActivity(undefined)
    setEditingOccurrence(occurrence)
    setFocusStartAt(true)
    setScheduleMode(true)
    setModalOpen(true)
  }

  function openCreate() {
    setDefaultActivity(undefined)
    setEditingOccurrence(undefined)
    setFocusStartAt(false)
    setScheduleMode(false)
    setModalOpen(true)
  }

  function openFromActivity(activity: Activity) {
    setEditingOccurrence(undefined)
    setDefaultActivity(activity)
    setFocusStartAt(true)
    setScheduleMode(false)
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditingOccurrence(undefined)
    setDefaultActivity(undefined)
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <RecommendationPanel
        date={dateStr}
        onOccurrenceClick={openEdit}
        onActivityClick={openFromActivity}
        mobileOpen={drawerOpen}
        onMobileClose={() => setDrawerOpen(false)}
      />

      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* Header */}
        <header className="flex h-[57px] shrink-0 items-center gap-2 border-b border-border px-4 md:gap-3 md:px-6">
          <button
            onClick={() => setDrawerOpen(true)}
            className="md:hidden flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Open suggestions"
          >
            <Menu className="h-4 w-4" strokeWidth={2} />
          </button>

          <div className="flex items-center gap-0.5">
            <button
              onClick={prev}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              onClick={next}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ChevronRight className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>

          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
            <span className="sm:hidden">{formatDayTitleCompact(current)}</span>
            <span className="hidden sm:inline">{formatDayTitle(current)}</span>
          </h1>

          <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
            {!isToday && (
              <button
                onClick={goToday}
                className="h-8 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted transition-colors"
              >
                Today
              </button>
            )}

            <input
              ref={dateInputRef}
              type="date"
              value={dateStr}
              onChange={(e) => {
                const d = new Date(e.target.value + 'T00:00:00')
                if (!isNaN(d.getTime())) setCurrent(sod(d))
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault()
              }}
              className="hidden sm:block h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring"
            />

            <button
              onClick={openCreate}
              className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              <span className="hidden sm:inline">New event</span>
            </button>
          </div>
        </header>

        {/* Canvas */}
        <div className="flex-1 overflow-y-auto">
          {/* Goal health strip */}
          {focusGoals.length > 0 && (
            <section className="border-b border-border px-6 py-4">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Focus Goals
              </h2>
              <div className="flex flex-col">
                {focusGoals.map((goal) => (
                  <GoalHealthRow key={goal.id} goal={goal} />
                ))}
              </div>
            </section>
          )}

          {/* Agenda */}
          <section className="flex flex-col gap-4 px-3 py-4 md:px-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-10">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : (
              <>
                {/* Scheduled */}
                <div>
                  <div className="mb-2 flex items-center justify-between px-1">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Scheduled
                    </h2>
                    {scheduledEvents.length > 0 && (
                      <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">
                        {scheduledEvents.length}
                      </span>
                    )}
                  </div>
                  {scheduledEvents.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-8 text-center">
                      <p className="text-sm text-muted-foreground">No events scheduled for this day.</p>
                      <button onClick={openCreate} className="text-sm text-primary hover:underline">
                        Add an event
                      </button>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-border">
                      <ul>
                        {scheduledEvents.map((event) => (
                          <AgendaRow key={event.id} event={event} onEdit={() => openEdit(event)} />
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Unscheduled */}
                {windowedEvents.length > 0 && (
                  <div>
                    <div className="mb-2 flex items-center justify-between px-1">
                      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Unscheduled
                      </h2>
                      <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">
                        {windowedEvents.length}
                      </span>
                    </div>
                    <div className="rounded-lg border border-border">
                      <ul>
                        {windowedEvents.map((event) => (
                          <AgendaRow
                            key={event.id}
                            event={event}
                            onEdit={() => openEdit(event)}
                            onSchedule={() => openSchedule(event)}
                          />
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {/* Floating */}
                {floatingOccurrences.length > 0 && (
                  <div>
                    <div className="mb-2 flex items-center justify-between px-1">
                      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Floating
                      </h2>
                      <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">
                        {floatingOccurrences.length}
                      </span>
                    </div>
                    <div className="rounded-lg border border-border">
                      <ul>
                        {floatingOccurrences.map((event) => (
                          <AgendaRow
                            key={event.id}
                            event={event}
                            onEdit={() => openEdit(event)}
                            onSchedule={() => openSchedule(event)}
                          />
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      <EventModal
        key={`${editingOccurrence?.id ?? defaultActivity?.id ?? 'new'}-${scheduleMode}`}
        open={modalOpen}
        onClose={closeModal}
        occurrence={editingOccurrence}
        defaultActivity={defaultActivity}
        focusStartAt={focusStartAt}
        scheduleOnly={scheduleMode}
      />
    </div>
  )
}
