import { useState, useMemo, useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, Menu, Plus, MoreHorizontal } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { eventsApi, goalsApi, settingsApi } from '@/lib/api'
import type { BaseEventSummary, Checkpoint, CheckpointSize, Event, EventStatus, Goal } from '@/lib/types'
import { EventModal } from '@/components/events/EventModal'
import { RecommendationPanel } from '@/components/recommendations/RecommendationStrip'
import { Badge } from '@/components/ui/Badge'

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

function formatTimeRange(event: Event): string {
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
  event: Event
  onEdit: () => void
}

function AgendaRow({ event, onEdit }: AgendaRowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()
  const isPending = event.status === 'pending'
  const isDone = event.status === 'done'
  const isSkipped = event.status === 'skipped'

  const statusMutation = useMutation({
    mutationFn: (status: EventStatus) => eventsApi.setStatus(event.id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => eventsApi.delete(event.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
    },
  })

  useEffect(() => {
    if (!menuOpen) return
    function close(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  const timeRange = formatTimeRange(event)
  const busy = statusMutation.isPending || deleteMutation.isPending
  const cat = event.category

  return (
    <li className="group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/40">
      {/* Status checkbox */}
      <button
        disabled={busy}
        onClick={() => {
          if (isPending) statusMutation.mutate('done')
          else statusMutation.mutate('pending')
        }}
        title={isDone ? 'Mark pending' : isSkipped ? 'Mark pending' : 'Mark done'}
        className={[
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
          isDone
            ? 'border-primary bg-primary text-primary-foreground'
            : isSkipped
              ? 'border-muted-foreground/40 bg-transparent text-muted-foreground/60'
              : 'border-border bg-transparent hover:border-primary hover:bg-primary/10',
        ].join(' ')}
      >
        {isDone && (
          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1.5,6 4.5,9 10.5,3" />
          </svg>
        )}
        {isSkipped && (
          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="2.5" y1="2.5" x2="9.5" y2="9.5" />
            <line x1="9.5" y1="2.5" x2="2.5" y2="9.5" />
          </svg>
        )}
      </button>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <button
            onClick={onEdit}
            className={[
              'text-left text-sm leading-snug',
              isPending ? 'text-foreground' : 'text-muted-foreground line-through',
            ].join(' ')}
          >
            {event.title}
          </button>
          {timeRange && (
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{timeRange}</span>
          )}
        </div>
        {(cat || event.goals.length > 0) && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {cat && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: cat.color }} />
                {cat.name}
              </span>
            )}
            {event.goals.map((g) => (
              <Badge key={g.id} tone={GOAL_TONE[g.status] ?? 'neutral'}>{g.title}</Badge>
            ))}
          </div>
        )}
      </div>

      {/* Options button + dropdown */}
      <div ref={menuRef} className="relative mt-0.5 shrink-0">
        <button
          disabled={busy}
          onClick={() => setMenuOpen((o) => !o)}
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
        >
          <MoreHorizontal className="h-4 w-4" strokeWidth={2} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full z-20 mt-1 min-w-[120px] rounded-lg border border-border bg-card py-1 shadow-pop">
            {isPending && (
              <button
                onClick={() => { statusMutation.mutate('skipped'); setMenuOpen(false) }}
                className="w-full px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
              >
                Skip
              </button>
            )}
            <button
              onClick={() => { onEdit(); setMenuOpen(false) }}
              className="w-full px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
            >
              Edit
            </button>
            <button
              onClick={() => { deleteMutation.mutate(); setMenuOpen(false) }}
              className="w-full px-3 py-1.5 text-left text-xs text-destructive hover:bg-muted"
            >
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
  const [editingEvent, setEditingEvent] = useState<Event | undefined>()
  const [defaultBaseEvent, setDefaultBaseEvent] = useState<BaseEventSummary | undefined>()
  const [focusStartAt, setFocusStartAt] = useState(false)

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

  const { data: events = [], isLoading: eventsLoading } = useQuery({
    queryKey: ['events', 'plan', dayStart.toISOString(), dayEnd.toISOString()],
    queryFn: () =>
      eventsApi.list({ startFrom: dayStart.toISOString(), endBefore: dayEnd.toISOString() }),
  })

  const { data: focusGoals = [] } = useQuery({
    queryKey: ['goals', { status: 'focus' }],
    queryFn: () => goalsApi.list({ status: 'focus' }),
  })

  const agendaEvents = useMemo(
    () =>
      [...events].sort((a, b) => {
        if (!a.startAt) return 1
        if (!b.startAt) return -1
        return new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
      }),
    [events],
  )

  function prev() { setCurrent((d) => addDays(d, -1)) }
  function next() { setCurrent((d) => addDays(d, 1)) }
  function goToday() { setCurrent(effectiveToday) }

  function openEdit(event: Event) {
    setDefaultBaseEvent(undefined)
    setEditingEvent(event)
    setFocusStartAt(!event.startAt)
    setModalOpen(true)
  }

  function openCreate() {
    setDefaultBaseEvent(undefined)
    setEditingEvent(undefined)
    setFocusStartAt(false)
    setModalOpen(true)
  }

  function openFromBaseEvent(baseEvent: BaseEventSummary) {
    setEditingEvent(undefined)
    setDefaultBaseEvent(baseEvent)
    setFocusStartAt(true)
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditingEvent(undefined)
    setDefaultBaseEvent(undefined)
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <RecommendationPanel
        date={dateStr}
        onEventClick={openEdit}
        onBaseEventClick={openFromBaseEvent}
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
              type="date"
              value={dateStr}
              onChange={(e) => {
                const d = new Date(e.target.value + 'T00:00:00')
                if (!isNaN(d.getTime())) setCurrent(sod(d))
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
          <section className="px-3 py-4 md:px-6">
            <div className="mb-2 flex items-center justify-between px-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Schedule
              </h2>
              {agendaEvents.length > 0 && (
                <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">
                  {agendaEvents.length}
                </span>
              )}
            </div>

            {eventsLoading ? (
              <div className="flex items-center justify-center py-10">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : agendaEvents.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <p className="text-sm text-muted-foreground">No events scheduled for this day.</p>
                <button
                  onClick={openCreate}
                  className="text-sm text-primary hover:underline"
                >
                  Add an event
                </button>
              </div>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {agendaEvents.map((event) => (
                  <AgendaRow key={event.id} event={event} onEdit={() => openEdit(event)} />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <EventModal
        open={modalOpen}
        onClose={closeModal}
        event={editingEvent}
        defaultBaseEvent={defaultBaseEvent}
        focusStartAt={focusStartAt}
      />
    </div>
  )
}
