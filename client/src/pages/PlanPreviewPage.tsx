import { useState, useMemo, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Plus, CalendarCheck, ArrowRight } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { occurrencesApi, goalsApi, settingsApi } from '@/lib/api'
import { toastError } from '@/store/toasts'
import type { Checkpoint, CheckpointSize, Occurrence, Goal } from '@/lib/types'
import { OccurrenceBar } from '@/components/goals/OccurrenceBar'
import { EventModal } from '@/components/events/EventModal'
import { OccurrenceListRow } from '@/components/events/OccurrenceListRow'

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
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
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

function agendaTimeText(event: Occurrence, showDate = false): string | null {
  const base = formatTimeRange(event)
  const dateRef = showDate ? event.startAt ?? event.endAt : null
  if (dateRef) return base ? `${formatDayLabel(dateRef)}, ${base}` : formatDayLabel(dateRef)
  return base || null
}

// Shift an ISO datetime onto a target calendar date, preserving clock time.
function shiftToDate(iso: string, target: Date): string {
  const d = new Date(iso)
  d.setFullYear(target.getFullYear(), target.getMonth(), target.getDate())
  return d.toISOString()
}

const SIZE_WEIGHT: Record<CheckpointSize, number> = { tiny: 1, small: 2, normal: 3, big: 5, huge: 8 }

function believedProgress(checkpoints: Checkpoint[]): number {
  const total = checkpoints.reduce((sum, c) => sum + SIZE_WEIGHT[c.size], 0)
  if (total === 0) return 0
  const reached = checkpoints
    .filter((c) => c.status === 'reached')
    .reduce((sum, c) => sum + SIZE_WEIGHT[c.size], 0)
  return (reached / total) * 100
}

function formatLastOccurrence(lastAt: string | null): string {
  if (!lastAt) return 'no sessions yet'
  const days = Math.floor((Date.now() - new Date(lastAt).getTime()) / (1000 * 60 * 60 * 24))
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 30)}mo ago`
}

function GoalHealthChip({ goal }: { goal: Goal }) {
  const progress = believedProgress(goal.checkpoints)
  const isMilestone = goal.kind === 'milestone'
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-lg border border-border px-3 py-2">
      <span className="h-2 w-2 shrink-0 rounded-full bg-goal-focus" />
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-foreground">{goal.title}</p>
        <p className="text-[10px] text-muted-foreground/70">last {formatLastOccurrence(goal.lastOccurrenceAt)}</p>
      </div>
      <div className="ml-auto shrink-0">
        {isMilestone ? (
          <span className="font-mono text-[11px] text-muted-foreground">{Math.round(progress)}%</span>
        ) : goal.occurrenceStats ? (
          <div className="flex w-20 items-center gap-1.5">
            <OccurrenceBar stats={goal.occurrenceStats} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

// ── Timeline row ──────────────────────────────────────────────────────────────

function relativeLabel(event: Occurrence, now: Date): { text: string; tone: 'now' | 'soon' | 'past' | 'none' } {
  if (event.status !== 'pending' || !event.startAt) return { text: '', tone: 'none' }
  const start = new Date(event.startAt).getTime()
  const end = event.endAt ? new Date(event.endAt).getTime() : start
  const t = now.getTime()
  if (t >= start && t <= end) return { text: 'now', tone: 'now' }
  const diffMin = Math.round((start - t) / 60000)
  if (diffMin > 0) {
    const h = Math.floor(diffMin / 60)
    const m = diffMin % 60
    // Keep it short so it never widens the time column.
    const text = h > 0 ? `in ${h}h` : `in ${m}m`
    return { text, tone: diffMin <= 60 ? 'soon' : 'none' }
  }
  return { text: '', tone: 'past' }
}

function TimelineRow({
  event,
  now,
  isToday,
  onEdit,
  onSchedule,
  showDate,
}: {
  event: Occurrence
  now: Date
  isToday: boolean
  onEdit: (o: Occurrence) => void
  onSchedule?: (o: Occurrence) => void
  showDate?: boolean
}) {
  const rel = isToday ? relativeLabel(event, now) : { text: '', tone: 'none' as const }
  const gutter = event.startAt && !event.isAllDay ? formatTime(event.startAt) : event.isAllDay ? 'All day' : '—'
  // `contents` so these three divs become cells of the parent timeline grid,
  // sharing one content-sized time column across every row.
  return (
    <div className="contents">
      {/* Time gutter */}
      <div className="whitespace-nowrap pt-3 text-left">
        <p className="text-xs font-medium tabular-nums text-foreground">{gutter}</p>
        {rel.text && (
          <p
            className={`text-[10px] font-medium ${
              rel.tone === 'now' ? 'text-primary' : rel.tone === 'soon' ? 'text-foreground/70' : 'text-muted-foreground/60'
            }`}
          >
            {rel.text}
          </p>
        )}
      </div>
      {/* Spine */}
      <div className="relative flex justify-center">
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
        <span
          className={`relative mt-4 h-2 w-2 rounded-full ring-4 ring-background ${
            rel.tone === 'now' ? 'bg-primary' : event.status === 'done' ? 'bg-primary/40' : 'bg-border'
          }`}
        />
      </div>
      {/* Card */}
      <div className="min-w-0 pb-2">
        <ul>
          <OccurrenceListRow occurrence={event} timeText={agendaTimeText(event, showDate)} onEdit={onEdit} onSchedule={onSchedule} />
        </ul>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function PlanPreviewPage() {
  const qc = useQueryClient()
  const [current, setCurrent] = useState<Date>(() => sod(new Date()))
  const [modalOpen, setModalOpen] = useState(false)
  const [editingOccurrence, setEditingOccurrence] = useState<Occurrence | undefined>()
  const [defaultActivity, setDefaultActivity] = useState<Occurrence['activity'] | undefined>()
  const [defaultStartAt, setDefaultStartAt] = useState<string | undefined>()
  const [defaultEndAt, setDefaultEndAt] = useState<string | undefined>()
  const [focusStartAt, setFocusStartAt] = useState(false)
  const [scheduleMode, setScheduleMode] = useState(false)
  const dateInputRef = useRef<HTMLInputElement>(null)

  // Live clock so the "now" line and relative labels stay honest.
  const [now, setNow] = useState<Date>(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const el = dateInputRef.current
    if (!el) return
    const handler = (e: WheelEvent) => e.preventDefault()
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get, staleTime: 5 * 60 * 1000 })

  const effectiveToday = useMemo(() => {
    const boundary = settings?.dayBoundaryTime ?? '00:00'
    const n = new Date()
    const [h, m] = boundary.split(':').map(Number)
    const b = new Date(n)
    b.setHours(h, m, 0, 0)
    return n < b ? addDays(sod(n), -1) : sod(n)
  }, [settings?.dayBoundaryTime])

  const dayStart = sod(current)
  const dayEnd = addDays(dayStart, 1)
  const dateStr = formatDateInput(current)
  const isToday = isSameDay(current, effectiveToday)

  const { data: occurrences = [], isLoading } = useQuery({
    queryKey: ['events', 'plan', dayStart.toISOString(), dayEnd.toISOString()],
    queryFn: () => occurrencesApi.list({ startFrom: dayStart.toISOString(), endBefore: dayEnd.toISOString() }),
  })

  const { data: allOccurrences = [], isLoading: isLoadingAll } = useQuery({
    queryKey: ['events', 'all'],
    queryFn: () => occurrencesApi.list(),
    enabled: isToday,
  })

  const anyLoading = isLoading || (isToday && isLoadingAll)

  const { data: focusGoals = [] } = useQuery({ queryKey: ['goals', { status: 'focus' }], queryFn: () => goalsApi.list({ status: 'focus' }) })

  const overdueEvents = useMemo(
    () =>
      isToday
        ? allOccurrences.filter((o) => o.isOverdue).sort((a, b) => new Date(a.startAt!).getTime() - new Date(b.startAt!).getTime())
        : [],
    [allOccurrences, isToday],
  )

  const timedEvents = useMemo(
    () =>
      occurrences
        .filter((o) => o.startAt !== null && !o.isPlanned && !(isToday && o.isOverdue))
        .sort((a, b) => new Date(a.startAt!).getTime() - new Date(b.startAt!).getTime()),
    [occurrences, isToday],
  )

  const plannedEvents = useMemo(() => occurrences.filter((o) => o.isPlanned), [occurrences])

  const { data: allFloating = [] } = useQuery({
    queryKey: ['events', 'floating'],
    queryFn: () => occurrencesApi.list({ floating: true, status: 'pending' }),
    staleTime: 30 * 1000,
  })
  const floatingEvents = useMemo(() => allFloating.filter((o) => !o.isPlanned), [allFloating])

  // Split the day's timeline around "now".
  const nowMs = now.getTime()
  const pastEvents = isToday ? timedEvents.filter((e) => new Date(e.endAt ?? e.startAt!).getTime() < nowMs || e.status !== 'pending') : []
  const futureEvents = isToday ? timedEvents.filter((e) => !(new Date(e.endAt ?? e.startAt!).getTime() < nowMs || e.status !== 'pending')) : timedEvents

  // Sweep overdue → tomorrow (relative to the effective today).
  const sweepMutation = useMutation({
    mutationFn: async () => {
      const tomorrow = addDays(effectiveToday, 1)
      await Promise.all(
        overdueEvents.map((o) =>
          occurrencesApi.update(o.id, {
            startAt: o.startAt ? shiftToDate(o.startAt, tomorrow) : null,
            endAt: o.endAt ? shiftToDate(o.endAt, tomorrow) : null,
          }),
        ),
      )
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] })
    },
    onError: (err) => toastError(err, 'Could not move overdue items.'),
  })

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
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* Header */}
        <header className="flex h-[57px] shrink-0 items-center gap-2 border-b border-border px-4 md:gap-3 md:px-6">
          <div className="flex items-center gap-0.5">
            <button onClick={prev} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
              <ChevronLeft className="h-4 w-4" strokeWidth={2} />
            </button>
            <button onClick={next} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
              <ChevronRight className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
            <span className="sm:hidden">{formatDayTitleCompact(current)}</span>
            <span className="hidden sm:inline">{formatDayTitle(current)}</span>
          </h1>
          <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
            {!isToday && (
              <button onClick={goToday} className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-foreground hover:bg-muted transition-colors">
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
              onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault() }}
              className="hidden sm:block h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button onClick={openCreate} className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-foreground hover:bg-muted transition-colors">
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        </header>

        {/* Canvas */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-5 md:px-6">
            {anyLoading ? (
              <div className="flex items-center justify-center py-10">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : (
              <>
                {/* Focus goals lead the day. The completion ring and done/left counts that used to
                    sit above them scored the day rather than the goals, which is the planner reading
                    this app is no longer for. */}
                {focusGoals.length > 0 && (
                  <section className="mb-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {focusGoals.map((g) => <GoalHealthChip key={g.id} goal={g} />)}
                  </section>
                )}

                <div className="flex flex-col gap-6">
                {/* Wrap-up / sweep */}
                {overdueEvents.length > 0 && (
                  <section className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">
                          {overdueEvents.length} overdue item{overdueEvents.length === 1 ? '' : 's'}
                        </p>
                      </div>
                      <button
                        onClick={() => sweepMutation.mutate()}
                        disabled={sweepMutation.isPending}
                        className="flex shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        Move to tomorrow
                        <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                    </div>
                    <div className="mt-3 rounded-lg border border-border bg-card">
                      <ul>
                        {overdueEvents.map((event) => (
                          <OccurrenceListRow key={event.id} occurrence={event} timeText={agendaTimeText(event, true)} onEdit={openEdit} />
                        ))}
                      </ul>
                    </div>
                  </section>
                )}

                {/* Timeline agenda */}
                <section>
                  <h2 className="mb-3 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {isToday ? 'Today' : 'Agenda'}
                  </h2>
                  {timedEvents.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-10 text-center">
                      <p className="text-sm text-muted-foreground">No timed events for this day.</p>
                      <button onClick={openCreate} className="text-sm text-primary hover:underline">Add an event</button>
                    </div>
                  ) : (
                    <div className="grid items-stretch gap-x-3" style={{ gridTemplateColumns: 'max-content 0.75rem minmax(0, 1fr)' }}>
                      {pastEvents.map((e) => (
                        <TimelineRow key={e.id} event={e} now={now} isToday={isToday} onEdit={openEdit} onSchedule={openSchedule} />
                      ))}
                      {isToday && (
                        <div className="contents">
                          <div className="flex items-center whitespace-nowrap py-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-primary tabular-nums">
                              {now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                            </span>
                          </div>
                          <div className="flex items-center justify-center py-1">
                            <span className="h-2 w-2 rounded-full bg-primary ring-4 ring-background" />
                          </div>
                          <div className="flex items-center py-1">
                            <span className="h-px w-full bg-primary/40" />
                          </div>
                        </div>
                      )}
                      {futureEvents.map((e) => (
                        <TimelineRow key={e.id} event={e} now={now} isToday={isToday} onEdit={openEdit} onSchedule={openSchedule} />
                      ))}
                    </div>
                  )}
                </section>

                {/* Planned */}
                {plannedEvents.length > 0 && (
                  <section>
                    <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Planned</h2>
                    <div className="rounded-lg border border-border">
                      <ul>
                        {plannedEvents.map((event) => (
                          <OccurrenceListRow key={event.id} occurrence={event} timeText={agendaTimeText(event)} onEdit={openEdit} onSchedule={openSchedule} />
                        ))}
                      </ul>
                    </div>
                  </section>
                )}

                {/* Floating */}
                {floatingEvents.length > 0 && (
                  <section>
                    <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Floating</h2>
                    <div className="rounded-lg border border-border">
                      <ul>
                        {floatingEvents.map((event) => (
                          <OccurrenceListRow key={event.id} occurrence={event} timeText={agendaTimeText(event)} onEdit={openEdit} onSchedule={openSchedule} />
                        ))}
                      </ul>
                    </div>
                  </section>
                )}
              </div>
              </>
            )}
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
