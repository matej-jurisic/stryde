import { useState, useMemo, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Menu, Plus, CalendarCheck } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { occurrencesApi, goalsApi, settingsApi } from '@/lib/api'
import { quotes } from '@/lib/quotes'
import type { Activity, Checkpoint, CheckpointSize, Occurrence, Goal } from '@/lib/types'
import type { ActivityTiming } from '@/components/recommendations/RecommendationStrip'
import { OccurrenceBar } from '@/components/goals/OccurrenceBar'
import { EventModal } from '@/components/events/EventModal'
import { OccurrenceListRow } from '@/components/events/OccurrenceListRow'
import { RecommendationPanel } from '@/components/recommendations/RecommendationStrip'

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

function formatDayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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
  if (event.isAllDay) {
    const dur = formatDuration(event.durationMinutes)
    return dur ? `Date only ~${dur}` : 'Date only'
  }
  if (!event.startAt && event.endAt) return `Due ${formatTime(event.endAt)}`
  if (!event.startAt) return ''
  if (event.endAt) {
    const range = `${formatTime(event.startAt)} - ${formatTime(event.endAt)}`
    const dur = formatDuration(event.durationMinutes)
    return dur ? `${range} ~${dur}` : range
  }
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

function formatLastOccurrence(lastAt: string | null): string {
  if (!lastAt) return 'no sessions yet'
  const days = Math.floor((Date.now() - new Date(lastAt).getTime()) / (1000 * 60 * 60 * 24))
  if (days === 0) return 'last done today'
  if (days === 1) return 'last done yesterday'
  if (days < 7) return `last done ${days}d ago`
  if (days < 30) return `last done ${Math.floor(days / 7)}w ago`
  const months = Math.floor(days / 30)
  return `last done ${months}mo ago`
}

function GoalHealthRow({ goal }: { goal: Goal }) {
  const progress = believedProgress(goal.checkpoints)
  const isMilestone = goal.kind === 'milestone'
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="h-2 w-2 shrink-0 rounded-full bg-goal-focus" />
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">{goal.title}</span>
        <span className="text-[10px] text-muted-foreground/70">{formatLastOccurrence(goal.lastOccurrenceAt)}</span>
      </div>
      {isMilestone ? (
        <>
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
        </>
      ) : goal.occurrenceStats ? (
        <OccurrenceBar stats={goal.occurrenceStats} barClassName="w-28" labelClassName="w-9" />
      ) : null}
    </div>
  )
}

// ── Agenda row time label ──────────────────────────────────────────────────

function agendaTimeText(event: Occurrence, showDate = false): string | null {
  const base = formatTimeRange(event)
  const dateRef = showDate ? event.startAt ?? event.endAt : null
  if (dateRef) return base ? `${formatDayLabel(dateRef)}, ${base}` : formatDayLabel(dateRef)
  return base || null
}

// ── PlanPage ───────────────────────────────────────────────────────────────

export function PlanPage() {
  const [current, setCurrent] = useState<Date>(() => sod(new Date()))
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingOccurrence, setEditingOccurrence] = useState<Occurrence | undefined>()
  const [defaultActivity, setDefaultActivity] = useState<Activity | undefined>()
  const [defaultStartAt, setDefaultStartAt] = useState<string | undefined>()
  const [defaultEndAt, setDefaultEndAt] = useState<string | undefined>()
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

  // Today's plan surfaces every overdue occurrence, whichever day it was
  // scheduled for, so the full list is needed. Shares the ['events', 'all']
  // cache with the Categories page and the nav badge.
  const { data: allOccurrences = [] } = useQuery({
    queryKey: ['events', 'all'],
    queryFn: () => occurrencesApi.list(),
    enabled: isToday,
  })

  const { data: focusGoals = [] } = useQuery({
    queryKey: ['goals', { status: 'focus' }],
    queryFn: () => goalsApi.list({ status: 'focus' }),
  })

  // isOverdue is server-computed and already implies pending. Every overdue
  // occurrence has a startAt (floating ones are never overdue), so sort on it.
  const overdueEvents = useMemo(
    () =>
      isToday
        ? allOccurrences
            .filter((o) => o.isOverdue)
            .sort((a, b) => new Date(a.startAt!).getTime() - new Date(b.startAt!).getTime())
        : [],
    [allOccurrences, isToday],
  )

  const scheduledEvents = useMemo(
    () =>
      occurrences
        // On today's view an overdue item moves to the Overdue section instead
        // (same "overdue wins" rule as the Categories page groups).
        .filter((o) => o.startAt !== null && !o.isPlanned && !(isToday && o.isOverdue))
        .sort((a, b) => new Date(a.startAt!).getTime() - new Date(b.startAt!).getTime()),
    [occurrences, isToday],
  )

  const plannedEvents = useMemo(
    () => occurrences.filter((o) => o.isPlanned),
    [occurrences],
  )

  // Floating occurrences have no day, so they show on every day. Planned ones
  // belong to the suggestions panel; the plan lists only the unplanned rest.
  const { data: allFloating = [] } = useQuery({
    queryKey: ['events', 'floating'],
    queryFn: () => occurrencesApi.list({ floating: true, status: 'pending' }),
    staleTime: 30 * 1000,
  })

  const floatingEvents = useMemo(
    () => allFloating.filter((o) => !o.isPlanned),
    [allFloating],
  )

  const isLoading = occurrencesLoading

  const dailyQuote = useMemo(() => {
    const seed = dateStr.split('-').reduce((acc, n) => acc + parseInt(n, 10), 0)
    return quotes[seed % quotes.length]
  }, [dateStr])

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

  function openFromActivity(activity: Activity, timing?: ActivityTiming) {
    setEditingOccurrence(undefined)
    setDefaultActivity(activity)
    setFocusStartAt(true)
    setScheduleMode(false)

    if (timing?.startTime) {
      const [h, m] = timing.startTime.split(':').map(Number)
      const start = new Date(current)
      start.setHours(h, m, 0, 0)
      const z = (n: number) => String(n).padStart(2, '0')
      const fmt = (d: Date) =>
        `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`
      setDefaultStartAt(fmt(start))
      setDefaultEndAt(
        timing.durationMinutes
          ? fmt(new Date(start.getTime() + timing.durationMinutes * 60000))
          : undefined,
      )
    } else {
      setDefaultStartAt(undefined)
      setDefaultEndAt(undefined)
    }

    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditingOccurrence(undefined)
    setDefaultActivity(undefined)
    setDefaultStartAt(undefined)
    setDefaultEndAt(undefined)
    setScheduleMode(false)
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <RecommendationPanel
        date={dateStr}
        today={formatDateInput(effectiveToday)}
        onOccurrenceClick={openSchedule}
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
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-foreground hover:bg-muted transition-colors"
              >
                <CalendarCheck className="h-3.5 w-3.5" strokeWidth={2} />
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
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-foreground hover:bg-muted transition-colors"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
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
                {/* Overdue - every overdue occurrence, not just this day's */}
                {overdueEvents.length > 0 && (
                  <div>
                    <div className="mb-2 flex items-center justify-between px-1">
                      <h2 className="text-xs font-semibold uppercase tracking-wide text-destructive">
                        Overdue
                      </h2>
                      <span className="rounded-full bg-destructive/10 px-1.5 text-[11px] font-medium text-destructive">
                        {overdueEvents.length}
                      </span>
                    </div>
                    <div className="rounded-lg border border-border">
                      <ul>
                        {overdueEvents.map((event) => (
                          <OccurrenceListRow
                            key={event.id}
                            occurrence={event}
                            timeText={agendaTimeText(event, true)}
                            onEdit={openEdit}
                          />
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

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
                          <OccurrenceListRow
                            key={event.id}
                            occurrence={event}
                            timeText={agendaTimeText(event)}
                            onEdit={openEdit}
                          />
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Planned */}
                {plannedEvents.length > 0 && (
                  <div>
                    <div className="mb-2 flex items-center justify-between px-1">
                      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Planned
                      </h2>
                      <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">
                        {plannedEvents.length}
                      </span>
                    </div>
                    <div className="rounded-lg border border-border">
                      <ul>
                        {plannedEvents.map((event) => (
                          <OccurrenceListRow
                            key={event.id}
                            occurrence={event}
                            timeText={agendaTimeText(event)}
                            onEdit={openEdit}
                            onSchedule={openSchedule}
                          />
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {/* Floating - unplanned, dateless occurrences, same on every day */}
                {floatingEvents.length > 0 && (
                  <div>
                    <div className="mb-2 flex items-center justify-between px-1">
                      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Floating
                      </h2>
                      <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">
                        {floatingEvents.length}
                      </span>
                    </div>
                    <div className="rounded-lg border border-border">
                      <ul>
                        {floatingEvents.map((event) => (
                          <OccurrenceListRow
                            key={event.id}
                            occurrence={event}
                            timeText={agendaTimeText(event)}
                            onEdit={openEdit}
                            onSchedule={openSchedule}
                          />
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

              </>
            )}
          </section>

          {/* Daily quote */}
          <div className="px-6 pb-8 pt-2 text-center">
            <p className="text-sm italic text-muted-foreground">"{dailyQuote.text}"</p>
            <p className="mt-1 text-xs text-muted-foreground/60">- {dailyQuote.author}</p>
          </div>
        </div>
      </div>

      <EventModal
        key={`${editingOccurrence?.id ?? defaultActivity?.id ?? 'new'}-${scheduleMode}-${defaultStartAt ?? ''}`}
        open={modalOpen}
        onClose={closeModal}
        occurrence={editingOccurrence}
        defaultActivity={defaultActivity}
        defaultStartAt={defaultStartAt}
        defaultEndAt={defaultEndAt}
        focusStartAt={focusStartAt}
        scheduleOnly={scheduleMode}
      />
    </div>
  )
}
