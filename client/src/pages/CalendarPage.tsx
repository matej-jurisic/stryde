import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown, Menu } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { occurrencesApi, settingsApi } from '@/lib/api'
import type { Activity, Occurrence } from '@/lib/types'
import { EventModal } from '@/components/events/EventModal'
import { EventDetailModal } from '@/components/events/EventDetailModal'
import { RecommendationPanel } from '@/components/recommendations/RecommendationStrip'

// ── Constants ──────────────────────────────────────────────────────────────

const HOUR_PX = 64

// ── Date utilities ─────────────────────────────────────────────────────────

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

function startOfWeek(d: Date): Date {
  const r = new Date(d)
  const dow = r.getDay()
  r.setDate(r.getDate() - (dow === 0 ? 6 : dow - 1))
  r.setHours(0, 0, 0, 0)
  return r
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function formatDatetimeLocal(d: Date): string {
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`
}

function formatDateInput(d: Date): string {
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}

// ── Label helpers ──────────────────────────────────────────────────────────

function hourLabel(h: number): string {
  return `${String(h).padStart(2, '0')}:00`
}

function timeLabel(iso: string): string {
  const d = new Date(iso)
  const h = d.getHours()
  const m = d.getMinutes()
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function pageTitle(view: ViewMode, days: Date[]): string {
  if (view === 'day') {
    return days[0].toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  }
  const f = days[0]
  const l = days[days.length - 1]
  if (f.getFullYear() !== l.getFullYear()) {
    return `${f.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - ${l.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
  }
  if (f.getMonth() !== l.getMonth()) {
    return `${f.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${l.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${l.getFullYear()}`
  }
  return `${f.toLocaleDateString('en-US', { month: 'long' })} ${f.getDate()} – ${l.getDate()}, ${l.getFullYear()}`
}

function compactTitle(view: ViewMode, days: Date[]): string {
  if (view === 'day') {
    return days[0].toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }
  const f = days[0]
  const l = days[days.length - 1]
  if (f.getMonth() === l.getMonth() && f.getFullYear() === l.getFullYear()) {
    return `${f.toLocaleDateString('en-US', { month: 'short' })} ${f.getDate()}-${l.getDate()}`
  }
  return `${f.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${l.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

function dayHeader(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })
}

// ── Layout algorithm ────────────────────────────────────────────────────────

interface LayoutEvent {
  event: Occurrence
  col: number
  totalCols: number
  topPx: number
  heightPx: number
}

function layoutDay(events: Occurrence[], day: Date): LayoutEvent[] {
  const dayStartMs = sod(day).getTime()

  const items = events
    .filter((e) => e.windowStart ? !!(e.windowStart && e.windowEnd) : !!e.startAt)
    .map((e) => {
      let startMs: number, endMs: number
      if (e.windowStart && e.windowEnd) {
        startMs = new Date(e.windowStart).getTime()
        endMs = new Date(e.windowEnd).getTime()
      } else {
        startMs = new Date(e.startAt!).getTime()
        endMs = e.endAt ? new Date(e.endAt).getTime() : startMs + 15 * 60 * 1000
      }
      // Clip to this day's boundaries (handles cross-midnight events)
      const clipStartMin = Math.max((startMs - dayStartMs) / 60000, 0)
      const clipEndMin = Math.min((endMs - dayStartMs) / 60000, 24 * 60)
      const s = clipStartMin
      const end = Math.max(clipEndMin, s + 15)
      return { event: e, s, end: Math.min(end, 24 * 60) }
    })
    .filter((it) => it.s < 24 * 60 && it.end > it.s)
    .sort((a, b) => a.s - b.s)

  const colEnds: number[] = []
  const colIdx: number[] = []

  for (const it of items) {
    let c = colEnds.findIndex((e) => e <= it.s)
    if (c === -1) {
      c = colEnds.length
      colEnds.push(it.end)
    } else {
      colEnds[c] = it.end
    }
    colIdx.push(c)
  }

  return items.map(({ event, s, end }, i) => {
    let maxC = colIdx[i]
    for (let j = 0; j < items.length; j++) {
      if (j !== i && items[j].s < end && items[j].end > s) {
        maxC = Math.max(maxC, colIdx[j])
      }
    }
    return {
      event,
      col: colIdx[i],
      totalCols: maxC + 1,
      topPx: (s / 60) * HOUR_PX,
      heightPx: Math.max(((end - s) / 60) * HOUR_PX, 28),
    }
  })
}

// ── Event coloring ──────────────────────────────────────────────────────────

type EventColors = { bgClass: string; bgHex?: string; leftColor: string; textClass: string }

function eventColors(o: Occurrence): EventColors {
  const category = o.activity.category
  if (category) {
    return {
      bgClass: '',
      bgHex: category.color,
      leftColor: category.color,
      textClass: 'text-foreground',
    }
  }
  return { bgClass: 'bg-muted', leftColor: 'var(--color-border)', textClass: 'text-foreground' }
}

function eventAllDayColors(o: Occurrence): { className: string; style?: React.CSSProperties } {
  const category = o.activity.category
  if (category) {
    return { className: 'text-foreground', style: { backgroundColor: category.color + '26' } }
  }
  return { className: 'bg-primary/10 text-primary' }
}

// ── EventBlock ──────────────────────────────────────────────────────────────

function EventBlock({
  layout,
  onClick,
  onMoveStart,
  onResizeStart,
  suppressClickRef,
  dimmed,
  isResizing,
}: {
  layout: LayoutEvent
  onClick: (e: Occurrence) => void
  onMoveStart?: (e: React.PointerEvent, topPx: number) => void
  onResizeStart?: (e: React.PointerEvent, side: 'top' | 'bottom') => void
  suppressClickRef?: { current: boolean }
  dimmed?: boolean
  isResizing?: boolean
}) {
  const { event, col, totalCols, topPx, heightPx } = layout
  const { bgClass, bgHex, leftColor, textClass } = eventColors(event)
  const isDone = event.status !== 'pending'
  const isWindowed = !!(event.windowStart && event.windowEnd)
  const accentColor = event.activity.category ? event.activity.category.color : 'var(--color-primary)'
  const isHex = accentColor.startsWith('#')
  const accentFaded = isHex ? `${accentColor}18` : `color-mix(in srgb, ${accentColor} 9%, transparent)`
  const accentMid   = isHex ? `${accentColor}60` : `color-mix(in srgb, ${accentColor} 38%, transparent)`

  const GAP = 2
  const leftPct = (col / totalCols) * 100
  const widthPct = 100 / totalCols

  const timeText = event.startAt
    ? `${timeLabel(event.startAt)}${event.endAt ? ` – ${timeLabel(event.endAt)}` : ''}`
    : ''

  const durationLabel = isWindowed && event.windowDurationMinutes
    ? event.windowDurationMinutes >= 60
      ? `~${Math.floor(event.windowDurationMinutes / 60)}h${event.windowDurationMinutes % 60 ? `${event.windowDurationMinutes % 60}m` : ''}`
      : `~${event.windowDurationMinutes}m`
    : null

  // Handles show always when resizing (touch mode), or on mouse hover via CSS
  const handleVisibility = isResizing ? 'flex' : 'hidden group-hover/calev:flex'

  function stopAll(e: React.SyntheticEvent) {
    e.stopPropagation()
  }

  const bodyPointerProps = {
    style: { touchAction: 'pan-y' as const },
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      onMoveStart?.(e, topPx)
    },
    onClick: (e: React.MouseEvent) => {
      if (suppressClickRef?.current) return
      e.stopPropagation()
      onClick(event)
    },
  }

  return (
    <div
      className={`absolute group/calev ${dimmed ? 'opacity-20' : ''}`}
      data-event-id={event.id}
      style={{
        top: topPx + GAP,
        height: Math.max(heightPx - GAP, 20),
        left: `calc(${leftPct}% + ${GAP}px)`,
        width: `calc(${widthPct}% - ${GAP * 2}px)`,
        zIndex: isResizing ? 25 : undefined,
      }}
    >
      {/* Top resize handle */}
      <div
        data-resize-handle="true"
        className={`absolute inset-x-0 top-0 z-20 h-2.5 cursor-ns-resize ${handleVisibility} items-center justify-center`}
        style={{ touchAction: 'none' }}
        onMouseDown={stopAll}
        onPointerDown={(e) => { e.stopPropagation(); onResizeStart?.(e, 'top') }}
        onClick={stopAll}
      >
        <div className="h-0.5 w-6 rounded-full bg-primary/70" />
      </div>

      {/* Event body */}
      {isWindowed ? (
        <button
          className={`absolute inset-0 overflow-hidden rounded-[4px] text-left transition-opacity hover:opacity-80 cursor-grab active:cursor-grabbing ${isDone ? 'opacity-40' : 'opacity-70'}`}
          style={{
            background: `repeating-linear-gradient(135deg, transparent, transparent 4px, ${accentFaded} 4px, ${accentFaded} 8px)`,
            border: `1.5px dashed ${accentMid}`,
            touchAction: 'pan-y',
          }}
          onPointerDown={bodyPointerProps.onPointerDown}
          onClick={bodyPointerProps.onClick}
        >
          <div className="px-1.5 py-0.5">
            {heightPx >= 20 && (
              <p className="overflow-hidden whitespace-nowrap text-[10px] font-medium leading-tight" style={{ color: accentColor }}>
                {event.effectiveTitle}{durationLabel ? ` ${durationLabel}` : ''}
              </p>
            )}
          </div>
        </button>
      ) : (
        <button
          className={`absolute inset-0 overflow-hidden rounded-[4px] border bg-card text-left transition-opacity hover:opacity-80 cursor-grab active:cursor-grabbing ${isDone ? 'opacity-50' : ''} ${isResizing ? 'border-primary/60 ring-1 ring-primary/40' : 'border-border/50'}`}
          {...bodyPointerProps}
        >
          <div
            className={`absolute inset-0 ${bgClass}`}
            style={bgHex ? { backgroundColor: bgHex + '22' } : undefined}
          />
          <div className="relative flex h-full">
            <div style={{ width: 3, minWidth: 3, background: leftColor }} className="shrink-0" />
            <div className="@container min-w-0 flex-1 px-1.5 py-0.5">
              {heightPx >= 20 && (
                <p
                  className={`@max-[10px]:hidden break-all overflow-hidden text-[11px] font-medium leading-tight ${
                    isDone ? 'line-through text-muted-foreground' : textClass
                  }`}
                >
                  {event.effectiveTitle}
                </p>
              )}
              {heightPx >= 44 && timeText && (
                <p className={`@max-[10px]:hidden overflow-hidden whitespace-nowrap text-[10px] leading-tight opacity-70 ${isDone ? 'text-muted-foreground' : textClass}`}>
                  {timeText}
                </p>
              )}
            </div>
          </div>
        </button>
      )}

      {/* Bottom resize handle */}
      <div
        data-resize-handle="true"
        className={`absolute inset-x-0 bottom-0 z-20 h-2.5 cursor-ns-resize ${handleVisibility} items-center justify-center`}
        style={{ touchAction: 'none' }}
        onMouseDown={stopAll}
        onPointerDown={(e) => { e.stopPropagation(); onResizeStart?.(e, 'bottom') }}
        onClick={stopAll}
      >
        <div className="h-0.5 w-6 rounded-full bg-primary/70" />
      </div>
    </div>
  )
}

// ── DayColumn ────────────────────────────────────────────────────────────────

// ── snapToGrid ──────────────────────────────────────────────────────────────

function snapToGrid(day: Date, yPx: number): Date {
  const totalMin = (yPx / HOUR_PX) * 60
  const hrs = Math.floor(totalMin / 60)
  const snapMins = Math.round((totalMin % 60) / 15) * 15
  const d = new Date(day)
  if (snapMins >= 60) {
    d.setHours(Math.min(hrs + 1, 23), 0, 0, 0)
  } else {
    d.setHours(Math.min(hrs, 23), snapMins, 0, 0)
  }
  return d
}

// ── DayColumn ────────────────────────────────────────────────────────────────

interface DayColumnProps {
  day: Date
  allEvents: Occurrence[]
  onEventClick: (e: Occurrence) => void
  overlay: { topPx: number; heightPx: number } | null
  moveOverlay: { topPx: number; heightPx: number } | null
  resizeOverlay: { topPx: number; heightPx: number } | null
  isToday: boolean
  borderLeft: boolean
  onEventMoveStart: (e: React.PointerEvent, event: Occurrence, topPx: number) => void
  onEventResizeStart: (e: React.PointerEvent, event: Occurrence, side: 'top' | 'bottom') => void
  suppressClickRef: { current: boolean }
  movingEventId: string | null
  resizingEventId: string | null
}

function DayColumn({ day, allEvents, onEventClick, overlay, moveOverlay, resizeOverlay, isToday, borderLeft, onEventMoveStart, onEventResizeStart, suppressClickRef, movingEventId, resizingEventId }: DayColumnProps) {
  const dayStart = sod(day)
  const dayEnd = addDays(dayStart, 1)

  const dayEvents = useMemo(
    () =>
      allEvents.filter((e) => {
        let startMs: number, endMs: number
        if (e.windowStart && e.windowEnd) {
          startMs = new Date(e.windowStart).getTime()
          endMs = new Date(e.windowEnd).getTime()
        } else if (e.startAt) {
          startMs = new Date(e.startAt).getTime()
          endMs = e.endAt ? new Date(e.endAt).getTime() : startMs + 15 * 60 * 1000
        } else {
          return false
        }
        return startMs < dayEnd.getTime() && endMs > dayStart.getTime()
      }),
    [allEvents, dayStart.getTime(), dayEnd.getTime()],
  )

  const layout = useMemo(() => layoutDay(dayEvents, day), [dayEvents, day])

  const now = new Date()
  const nowPx = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX

  return (
    <div
      className={`relative flex-1 ${borderLeft ? 'border-l border-border' : ''}`}
      style={{ height: HOUR_PX * 24 }}
    >
      {/* Hour lines */}
      {Array.from({ length: 24 }, (_, h) => (
        <div
          key={h}
          className="absolute inset-x-0 border-t border-border"
          style={{ top: h * HOUR_PX }}
        />
      ))}
      {/* Half-hour lines */}
      {Array.from({ length: 24 }, (_, h) => (
        <div
          key={`hh${h}`}
          className="absolute inset-x-0 border-t border-border/40"
          style={{ top: h * HOUR_PX + HOUR_PX / 2 }}
        />
      ))}
      {/* Current time indicator */}
      {isToday && (
        <div
          className="pointer-events-none absolute inset-x-0 z-[5] flex items-center"
          style={{ top: nowPx }}
        >
          <div className="h-[9px] w-[9px] shrink-0 rounded-full bg-destructive -ml-[5px]" />
          <div className="h-px flex-1 bg-destructive" />
        </div>
      )}
      {/* Drag selection overlay */}
      {overlay && (
        <div
          className="pointer-events-none absolute inset-x-0 z-20 rounded-[4px] bg-primary/20 border border-primary/60"
          style={{ top: overlay.topPx, height: overlay.heightPx }}
        />
      )}
      {/* Event move ghost */}
      {moveOverlay && (
        <div
          className="pointer-events-none absolute inset-x-0 z-30 rounded-[4px] border-2 border-primary bg-primary/20"
          style={{ top: moveOverlay.topPx, height: moveOverlay.heightPx }}
        />
      )}
      {/* Event resize ghost */}
      {resizeOverlay && (
        <div
          className="pointer-events-none absolute inset-x-0 z-30 rounded-[4px] border-2 border-dashed border-primary/80 bg-primary/10"
          style={{ top: resizeOverlay.topPx, height: resizeOverlay.heightPx }}
        />
      )}
      {/* Event blocks */}
      {layout.map((l) => (
        <EventBlock
          key={l.event.id}
          layout={l}
          onClick={onEventClick}
          onMoveStart={(e, topPx) => onEventMoveStart(e, l.event, topPx)}
          onResizeStart={(e, side) => onEventResizeStart(e, l.event, side)}
          suppressClickRef={suppressClickRef}
          dimmed={l.event.id === movingEventId}
          isResizing={l.event.id === resizingEventId}
        />
      ))}
    </div>
  )
}

// ── CalendarPage ─────────────────────────────────────────────────────────────

type ViewMode = 'day' | '3day' | 'week'

export function CalendarPage() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [view, setView] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('stryde-calendar-view')
    return saved === 'week' ? 'week' : saved === '3day' ? '3day' : 'day'
  })
  const [viewDropOpen, setViewDropOpen] = useState(false)
  const viewDropRef = useRef<HTMLDivElement>(null)
  const [current, setCurrent] = useState(() => new Date())
  const [modalOpen, setModalOpen] = useState(false)
  const [editingOccurrence, setEditingOccurrence] = useState<Occurrence | undefined>()
  const [defaultStartAt, setDefaultStartAt] = useState<string | undefined>()
  const [defaultEndAt, setDefaultEndAt] = useState<string | undefined>()
  const [defaultActivity, setDefaultActivity] = useState<Activity | undefined>()
  const [focusStartAt, setFocusStartAt] = useState(false)
  const [scheduleMode, setScheduleMode] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailEvent, setDetailEvent] = useState<Occurrence | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    startDayIdx: number
    startClientX: number
    startClientY: number
    startY: number
    isDrag: boolean
  } | null>(null)
  const pendingTouchRef = useRef<{
    pointerId: number
    startClientX: number
    startClientY: number
    startDayIdx: number
    startY: number
    timer: ReturnType<typeof setTimeout>
  } | null>(null)
  const autoScrollRef = useRef<{ rafId: number; clientX: number; clientY: number } | null>(null)
  const [dragOverlays, setDragOverlays] = useState<Map<number, { topPx: number; heightPx: number }>>(
    () => new Map(),
  )
  const eventMoveRef = useRef<{
    event: Occurrence
    durationMs: number
    offsetPx: number
    isDragging: boolean
  } | null>(null)
  const suppressClickRef = useRef(false)
  const [moveOverlay, setMoveOverlay] = useState<{ dayIdx: number; topPx: number; heightPx: number } | null>(null)
  const [movingEventId, setMovingEventId] = useState<string | null>(null)
  const [resizingEventId, setResizingEventId] = useState<string | null>(null)
  const [resizeOverlay, setResizeOverlay] = useState<Map<number, { topPx: number; heightPx: number }>>(() => new Map())
  const resizeDragActiveRef = useRef(false)
  const resizeStateRef = useRef<{
    origStartMs: number
    origEndMs: number
    side: 'top' | 'bottom'
  } | null>(null)

  const queryClient = useQueryClient()

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
    staleTime: 5 * 60 * 1000,
  })

  // Effective "today" respecting the day boundary
  const effectiveToday = useMemo(() => {
    const boundary = settings?.dayBoundaryTime ?? '00:00'
    const now = new Date()
    const [h, m] = boundary.split(':').map(Number)
    const b = new Date(now)
    b.setHours(h, m, 0, 0)
    return now < b ? addDays(sod(now), -1) : sod(now)
  }, [settings?.dayBoundaryTime])

  // Days to render
  const days = useMemo<Date[]>(() => {
    if (view === 'day') return [sod(current)]
    if (view === '3day') return Array.from({ length: 3 }, (_, i) => addDays(sod(current), i))
    const ws = startOfWeek(current)
    return Array.from({ length: 7 }, (_, i) => addDays(ws, i))
  }, [view, current])

  const rangeStart = days[0]
  const rangeEnd = addDays(days[days.length - 1], 1)

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['events', 'calendar', rangeStart.toISOString(), rangeEnd.toISOString()],
    queryFn: () =>
      occurrencesApi.list({
        startFrom: rangeStart.toISOString(),
        endBefore: rangeEnd.toISOString(),
      }),
  })

  // Scroll to current time on mount
  useEffect(() => {
    if (scrollRef.current) {
      const now = new Date()
      const px = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX
      scrollRef.current.scrollTop = Math.max(0, px - 200)
    }
  }, [])

  useEffect(() => {
    if (!viewDropOpen) return
    function close(e: MouseEvent) {
      if (viewDropRef.current && !viewDropRef.current.contains(e.target as Node)) setViewDropOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [viewDropOpen])


  function prev() {
    const step = view === 'day' ? -1 : view === '3day' ? -3 : -7
    setCurrent((d) => addDays(d, step))
  }

  function next() {
    const step = view === 'day' ? 1 : view === '3day' ? 3 : 7
    setCurrent((d) => addDays(d, step))
  }

  function goToday() {
    setCurrent(effectiveToday)
  }

  function openFromActivity(activity: Activity) {
    setEditingOccurrence(undefined)
    setDefaultStartAt(undefined)
    setDefaultEndAt(undefined)
    setDefaultActivity(activity)
    setFocusStartAt(true)
    setModalOpen(true)
  }

  function openCreate(startAt?: string, endAt?: string) {
    setDefaultActivity(undefined)
    setEditingOccurrence(undefined)
    setDefaultStartAt(startAt)
    setDefaultEndAt(endAt)
    setFocusStartAt(false)
    setModalOpen(true)
  }

  function openDetail(o: Occurrence) {
    setDetailEvent(o)
    setDetailOpen(true)
  }

  function openEdit(o: Occurrence) {
    setDefaultActivity(undefined)
    setEditingOccurrence(o)
    setDefaultStartAt(undefined)
    setDefaultEndAt(undefined)
    setFocusStartAt(!o.startAt)
    setScheduleMode(false)
    setModalOpen(true)
  }

  function openSchedule(o: Occurrence) {
    setDefaultActivity(undefined)
    setEditingOccurrence(o)
    setDefaultStartAt(undefined)
    setDefaultEndAt(undefined)
    setFocusStartAt(true)
    setScheduleMode(true)
    setModalOpen(true)
  }

  // ── Event move drag ──────────────────────────────────────────────────────

  function handleEventMoveStart(e: React.PointerEvent, event: Occurrence, topPx: number) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const isWindowed = !!(event.windowStart && event.windowEnd)
    if (!event.startAt && !isWindowed) return
    // Dismiss any active touch resize mode when interacting with an event body
    if (resizingEventId) {
      setResizingEventId(null)
      if (resizingEventId === event.id) {
        suppressClickRef.current = true
        setTimeout(() => { suppressClickRef.current = false }, 0)
        return
      }
    }
    e.stopPropagation()

    const startMs = isWindowed ? new Date(event.windowStart!).getTime() : new Date(event.startAt!).getTime()
    const endMs = isWindowed
      ? new Date(event.windowEnd!).getTime()
      : (event.endAt ? new Date(event.endAt).getTime() : startMs + 15 * 60 * 1000)
    const durationMs = endMs - startMs
    const isTouch = e.pointerType === 'touch'
    const pointerId = e.pointerId
    const startClientX = e.clientX
    const startClientY = e.clientY
    const gridY = getYInGrid(startClientY)
    const offsetPx = gridY - topPx

    function startDragging() {
      eventMoveRef.current = { event, durationMs, offsetPx, isDragging: false }
      // Dim the event immediately on touch to confirm long-press registered
      if (isTouch) setMovingEventId(event.id)
      if (!isTouch) document.body.style.cursor = 'grabbing'

      function onPointerMove(mv: PointerEvent) {
        if (isTouch && mv.pointerId !== pointerId) return
        if (!eventMoveRef.current) return
        if (!eventMoveRef.current.isDragging) {
          if (!isTouch) {
            // Mouse needs a small movement threshold to distinguish click from drag
            const dx = mv.clientX - startClientX
            const dy = mv.clientY - startClientY
            if (Math.abs(dx) + Math.abs(dy) < 8) return
            document.body.style.cursor = 'grabbing'
          }
          eventMoveRef.current.isDragging = true
          setMovingEventId(event.id)
        }
        const curY = getYInGrid(mv.clientY)
        const anchorY = Math.max(0, curY - eventMoveRef.current.offsetPx)
        const curDayIdx = Math.max(0, Math.min(getDayIdxFromX(mv.clientX), days.length - 1))
        const startSnapped = snapToGrid(days[curDayIdx], anchorY)
        const startMin = startSnapped.getHours() * 60 + startSnapped.getMinutes()
        const durationMin = eventMoveRef.current.durationMs / 60000
        setMoveOverlay({
          dayIdx: curDayIdx,
          topPx: (startMin / 60) * HOUR_PX,
          heightPx: Math.max((durationMin / 60) * HOUR_PX, 20),
        })
        startAutoScroll(mv.clientX, mv.clientY)
      }

      function cleanup() {
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('pointercancel', onPointerCancel)
        document.body.style.cursor = ''
        stopAutoScroll()
      }

      function onPointerUp(mu: PointerEvent) {
        if (isTouch && mu.pointerId !== pointerId) return
        cleanup()
        if (!eventMoveRef.current) return
        const { event: ev, durationMs: dur, offsetPx: off, isDragging } = eventMoveRef.current
        eventMoveRef.current = null
        setMoveOverlay(null)
        setMovingEventId(null)
        if (!isDragging) {
          // Hold-and-release without drag: enter resize mode (touch only; mouse uses hover handles)
          if (isTouch) {
            suppressClickRef.current = true
            setTimeout(() => { suppressClickRef.current = false }, 0)
            setResizingEventId(ev.id)
          }
          return
        }
        suppressClickRef.current = true
        setTimeout(() => { suppressClickRef.current = false }, 0)
        const curY = getYInGrid(mu.clientY)
        const anchorY = Math.max(0, curY - off)
        const curDayIdx = Math.max(0, Math.min(getDayIdxFromX(mu.clientX), days.length - 1))
        const newStart = snapToGrid(days[curDayIdx], anchorY)
        const newEnd = new Date(newStart.getTime() + dur)
        const origStartMs = ev.windowStart ? new Date(ev.windowStart).getTime() : new Date(ev.startAt!).getTime()
        if (newStart.getTime() === origStartMs) return
        rescheduleEvent(ev, newStart, newEnd)
      }

      function onPointerCancel(pc: PointerEvent) {
        if (isTouch && pc.pointerId !== pointerId) return
        cleanup()
        eventMoveRef.current = null
        setMoveOverlay(null)
        setMovingEventId(null)
      }

      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
      window.addEventListener('pointercancel', onPointerCancel)
    }

    if (isTouch) {
      // Long-press (500ms) before drag activates, so normal taps/scrolls still work.
      // touch-action:pan-y on the event body means the browser only claims the touch when
      // it detects actual vertical movement (firing pointercancel then), so a stationary
      // hold never gets cancelled and the timer always reaches 500ms.
      let cancelled = false
      let timer: ReturnType<typeof setTimeout>

      function cancelEarly() {
        cancelled = true
        clearTimeout(timer)
        window.removeEventListener('pointermove', onEarlyMove)
        window.removeEventListener('pointerup', onEarlyUp)
        window.removeEventListener('pointercancel', onEarlyCancel)
      }

      function onEarlyMove(mv: PointerEvent) {
        if (mv.pointerId !== pointerId) return
        const dx = mv.clientX - startClientX
        const dy = mv.clientY - startClientY
        if (Math.sqrt(dx * dx + dy * dy) > 10) cancelEarly()
      }

      function onEarlyUp(up: PointerEvent) {
        if (up.pointerId !== pointerId) return
        cancelEarly()
      }

      function onEarlyCancel(pc: PointerEvent) {
        if (pc.pointerId !== pointerId) return
        cancelEarly()
      }

      window.addEventListener('pointermove', onEarlyMove)
      window.addEventListener('pointerup', onEarlyUp)
      window.addEventListener('pointercancel', onEarlyCancel)

      timer = setTimeout(() => {
        if (cancelled) return
        window.removeEventListener('pointermove', onEarlyMove)
        window.removeEventListener('pointerup', onEarlyUp)
        window.removeEventListener('pointercancel', onEarlyCancel)
        if (navigator.vibrate) navigator.vibrate(30)
        startDragging()
      }, 500)
    } else {
      startDragging()
    }
  }

  function rescheduleEvent(ev: Occurrence, newStart: Date, newEnd: Date) {
    const isWindowed = !!(ev.windowStart && ev.windowEnd)
    queryClient.setQueryData<Occurrence[]>(
      ['events', 'calendar', rangeStart.toISOString(), rangeEnd.toISOString()],
      (old) => old?.map((o) => {
        if (o.id !== ev.id) return o
        return isWindowed
          ? { ...o, windowStart: newStart.toISOString(), windowEnd: newEnd.toISOString() }
          : { ...o, startAt: newStart.toISOString(), endAt: newEnd.toISOString() }
      }),
    )
    occurrencesApi.update(ev.id, {
      title: ev.title,
      startAt: isWindowed ? ev.startAt : newStart.toISOString(),
      endAt: isWindowed ? ev.endAt : newEnd.toISOString(),
      isAllDay: ev.isAllDay,
      windowStart: isWindowed ? newStart.toISOString() : ev.windowStart,
      windowEnd: isWindowed ? newEnd.toISOString() : ev.windowEnd,
      windowDurationMinutes: ev.windowDurationMinutes,
    }).finally(() => {
      queryClient.invalidateQueries({ queryKey: ['events'] })
      queryClient.invalidateQueries({ queryKey: ['recommendations'] })
    })
  }

  // ── Event resize drag ──────────────────────────────────────────────────────

  function handleResizeStart(e: React.PointerEvent, event: Occurrence, side: 'top' | 'bottom') {
    const isWindowed = !!(event.windowStart && event.windowEnd)
    if (!event.startAt && !isWindowed) return
    e.stopPropagation()

    const origStartMs = isWindowed
      ? new Date(event.windowStart!).getTime()
      : new Date(event.startAt!).getTime()
    const origEndMs = isWindowed
      ? new Date(event.windowEnd!).getTime()
      : (event.endAt ? new Date(event.endAt).getTime() : origStartMs + 15 * 60 * 1000)

    resizeDragActiveRef.current = true
    resizeStateRef.current = { origStartMs, origEndMs, side }
    document.body.style.cursor = 'ns-resize'

    function overlayForPointer(clientX: number, clientY: number): Map<number, { topPx: number; heightPx: number }> {
      const curDay = days[Math.max(0, Math.min(getDayIdxFromX(clientX), days.length - 1))]
      const snappedMs = snapToGrid(curDay, Math.max(0, Math.min(getYInGrid(clientY), HOUR_PX * 24 - 1))).getTime()
      if (side === 'top') {
        return computeResizeOverlays(Math.min(snappedMs, origEndMs - 15 * 60 * 1000), origEndMs)
      } else {
        return computeResizeOverlays(origStartMs, Math.max(snappedMs, origStartMs + 15 * 60 * 1000))
      }
    }

    function onPointerMove(mv: PointerEvent) {
      setResizeOverlay(overlayForPointer(mv.clientX, mv.clientY))
      startAutoScroll(mv.clientX, mv.clientY)
    }

    function cleanup() {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      resizeDragActiveRef.current = false
      resizeStateRef.current = null
      document.body.style.cursor = ''
      stopAutoScroll()
    }

    function onPointerUp(mu: PointerEvent) {
      cleanup()
      setResizeOverlay(new Map())

      const curDayIdx = Math.max(0, Math.min(getDayIdxFromX(mu.clientX), days.length - 1))
      const curDay = days[curDayIdx]
      const curY = getYInGrid(mu.clientY)
      const snappedMs = snapToGrid(curDay, Math.max(0, Math.min(curY, HOUR_PX * 24 - 1))).getTime()

      let newStart: Date
      let newEnd: Date

      if (side === 'top') {
        newStart = new Date(Math.min(snappedMs, origEndMs - 15 * 60 * 1000))
        newEnd = new Date(origEndMs)
      } else {
        newStart = new Date(origStartMs)
        newEnd = new Date(Math.max(snappedMs, origStartMs + 15 * 60 * 1000))
      }

      if (newStart.getTime() !== origStartMs || newEnd.getTime() !== origEndMs) {
        rescheduleEvent(event, newStart, newEnd)
      }
    }

    function onPointerCancel() {
      cleanup()
      setResizeOverlay(new Map())
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
  }

  // ── Grid drag helpers ────────────────────────────────────────────────────

  function getDayIdxFromX(clientX: number): number {
    if (!gridRef.current) return 0
    const rect = gridRef.current.getBoundingClientRect()
    const colWidth = rect.width / days.length
    return Math.max(0, Math.min(Math.floor((clientX - rect.left) / colWidth), days.length - 1))
  }

  function getYInGrid(clientY: number): number {
    if (!gridRef.current) return 0
    const rect = gridRef.current.getBoundingClientRect()
    return Math.max(0, Math.min(clientY - rect.top, HOUR_PX * 24 - 1))
  }

  function computeOverlays(
    startDayIdx: number,
    startY: number,
    endDayIdx: number,
    endY: number,
  ): Map<number, { topPx: number; heightPx: number }> {
    const minIdx = Math.min(startDayIdx, endDayIdx)
    const maxIdx = Math.max(startDayIdx, endDayIdx)
    const result = new Map<number, { topPx: number; heightPx: number }>()
    for (let i = minIdx; i <= maxIdx; i++) {
      if (startDayIdx === endDayIdx) {
        const topY = Math.min(startY, endY)
        const botY = Math.max(startY, endY)
        const s = snapToGrid(days[i], topY)
        const en = snapToGrid(days[i], botY)
        const topPx = (s.getHours() * 60 + s.getMinutes()) / 60 * HOUR_PX
        const endPx = (en.getHours() * 60 + en.getMinutes()) / 60 * HOUR_PX
        result.set(i, { topPx, heightPx: Math.max(endPx - topPx, HOUR_PX / 4) })
      } else if (i === minIdx) {
        const anchorY = startDayIdx < endDayIdx ? startY : endY
        const s = snapToGrid(days[i], anchorY)
        const topPx = (s.getHours() * 60 + s.getMinutes()) / 60 * HOUR_PX
        result.set(i, { topPx, heightPx: HOUR_PX * 24 - topPx })
      } else if (i === maxIdx) {
        const anchorY = startDayIdx > endDayIdx ? startY : endY
        const en = snapToGrid(days[i], anchorY)
        const endPx = (en.getHours() * 60 + en.getMinutes()) / 60 * HOUR_PX
        result.set(i, { topPx: 0, heightPx: Math.max(endPx, HOUR_PX / 4) })
      } else {
        result.set(i, { topPx: 0, heightPx: HOUR_PX * 24 })
      }
    }
    return result
  }

  function computeResizeOverlays(startMs: number, endMs: number): Map<number, { topPx: number; heightPx: number }> {
    const result = new Map<number, { topPx: number; heightPx: number }>()
    for (let i = 0; i < days.length; i++) {
      const dayStartMs = sod(days[i]).getTime()
      const dayEndMs = dayStartMs + 86400000
      if (endMs <= dayStartMs || startMs >= dayEndMs) continue
      const segStartMs = Math.max(startMs, dayStartMs)
      const segEndMs = Math.min(endMs, dayEndMs)
      const startMin = (segStartMs - dayStartMs) / 60000
      const endMin = (segEndMs - dayStartMs) / 60000
      result.set(i, {
        topPx: (startMin / 60) * HOUR_PX,
        heightPx: Math.max(((endMin - startMin) / 60) * HOUR_PX, 20),
      })
    }
    return result
  }

  function handleGridMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if ((e.target as Element).closest('button')) return
    if (e.button !== 0) return
    const dayIdx = getDayIdxFromX(e.clientX)
    const y = getYInGrid(e.clientY)
    dragRef.current = {
      startDayIdx: dayIdx,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startY: y,
      isDrag: false,
    }

    function onMouseMove(mv: MouseEvent) {
      if (!dragRef.current) return
      const dx = mv.clientX - dragRef.current.startClientX
      const dy = mv.clientY - dragRef.current.startClientY
      if (!dragRef.current.isDrag && Math.abs(dx) + Math.abs(dy) < 8) return
      dragRef.current.isDrag = true
      const endDayIdx = getDayIdxFromX(mv.clientX)
      const endY = getYInGrid(mv.clientY)
      setDragOverlays(computeOverlays(dragRef.current.startDayIdx, dragRef.current.startY, endDayIdx, endY))
    }

    function onMouseUp(mu: MouseEvent) {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      if (!dragRef.current) return
      const { startDayIdx, startY, isDrag } = dragRef.current
      dragRef.current = null
      setDragOverlays(new Map())
      if (!isDrag) return

      const endDayIdx = getDayIdxFromX(mu.clientX)
      const endY = getYInGrid(mu.clientY)

      let startDate: Date
      let endDate: Date
      if (startDayIdx < endDayIdx) {
        startDate = snapToGrid(days[startDayIdx], startY)
        endDate = snapToGrid(days[endDayIdx], endY)
      } else if (startDayIdx > endDayIdx) {
        startDate = snapToGrid(days[endDayIdx], endY)
        endDate = snapToGrid(days[startDayIdx], startY)
      } else {
        startDate = snapToGrid(days[startDayIdx], Math.min(startY, endY))
        endDate = snapToGrid(days[startDayIdx], Math.max(startY, endY))
      }
      if (endDate <= startDate) endDate.setMinutes(endDate.getMinutes() + 15)
      openCreate(formatDatetimeLocal(startDate), formatDatetimeLocal(endDate))
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  // ── Touch drag via pointer capture ───────────────────────────────────────
  // pointercancel fires when the browser takes over the gesture for scrolling,
  // giving us a reliable signal to abort without false-firing during normal scrolls.

  // Once the long-press arms a drag, native scrolling must be suppressed by
  // preventDefault-ing touchmove from a non-passive listener. Pointer capture and
  // overflow toggles don't stop the browser's pan gesture, and React registers its
  // touch handlers as passive, so this has to be a native listener.
  useEffect(() => {
    function onTouchMove(e: TouchEvent) {
      if (dragRef.current?.isDrag || eventMoveRef.current?.isDragging || resizeDragActiveRef.current) e.preventDefault()
    }
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => document.removeEventListener('touchmove', onTouchMove)
  }, [])

  // Dismiss touch resize mode when the user taps outside the event or its handles
  useEffect(() => {
    if (!resizingEventId) return
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Element
      if (
        target.closest('[data-resize-handle]') ||
        target.closest(`[data-event-id="${resizingEventId}"]`)
      ) return
      setResizingEventId(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [resizingEventId])

  function stopAutoScroll() {
    if (autoScrollRef.current) {
      cancelAnimationFrame(autoScrollRef.current.rafId)
      autoScrollRef.current = null
    }
  }

  function startAutoScroll(clientX: number, clientY: number) {
    if (autoScrollRef.current) {
      autoScrollRef.current.clientX = clientX
      autoScrollRef.current.clientY = clientY
      return
    }
    const state = { rafId: 0, clientX, clientY }
    autoScrollRef.current = state
    const ZONE = 80
    const MAX_SPEED = 12
    function tick() {
      if (!autoScrollRef.current || autoScrollRef.current !== state) return
      const anyDragActive = dragRef.current?.isDrag || eventMoveRef.current?.isDragging || resizeDragActiveRef.current
      if (!anyDragActive || !scrollRef.current) { autoScrollRef.current = null; return }
      const rect = scrollRef.current.getBoundingClientRect()
      const distTop = state.clientY - rect.top
      const distBot = rect.bottom - state.clientY
      let speed = 0
      if (distTop < ZONE && distTop >= 0) speed = -MAX_SPEED * (1 - distTop / ZONE)
      else if (distBot < ZONE && distBot >= 0) speed = MAX_SPEED * (1 - distBot / ZONE)
      if (speed !== 0) {
        scrollRef.current.scrollTop += speed
        if (dragRef.current?.isDrag) {
          const endDayIdx = getDayIdxFromX(state.clientX)
          const endY = getYInGrid(state.clientY)
          setDragOverlays(computeOverlays(dragRef.current.startDayIdx, dragRef.current.startY, endDayIdx, endY))
        } else if (eventMoveRef.current?.isDragging) {
          const curY = getYInGrid(state.clientY)
          const anchorY = Math.max(0, curY - eventMoveRef.current.offsetPx)
          const curDayIdx = Math.max(0, Math.min(getDayIdxFromX(state.clientX), days.length - 1))
          const startSnapped = snapToGrid(days[curDayIdx], anchorY)
          const startMin = startSnapped.getHours() * 60 + startSnapped.getMinutes()
          const durationMin = eventMoveRef.current.durationMs / 60000
          setMoveOverlay({
            dayIdx: curDayIdx,
            topPx: (startMin / 60) * HOUR_PX,
            heightPx: Math.max((durationMin / 60) * HOUR_PX, 20),
          })
        } else if (resizeDragActiveRef.current && resizeStateRef.current) {
          const rs = resizeStateRef.current
          const curDay = days[Math.max(0, Math.min(getDayIdxFromX(state.clientX), days.length - 1))]
          const snappedMs = snapToGrid(curDay, Math.max(0, Math.min(getYInGrid(state.clientY), HOUR_PX * 24 - 1))).getTime()
          if (rs.side === 'top') {
            setResizeOverlay(computeResizeOverlays(Math.min(snappedMs, rs.origEndMs - 15 * 60 * 1000), rs.origEndMs))
          } else {
            setResizeOverlay(computeResizeOverlays(rs.origStartMs, Math.max(snappedMs, rs.origStartMs + 15 * 60 * 1000)))
          }
        }
      }
      state.rafId = requestAnimationFrame(tick)
    }
    state.rafId = requestAnimationFrame(tick)
  }

  function handleGridPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'touch') return
    if ((e.target as Element).closest('button')) return
    const startClientX = e.clientX
    const startClientY = e.clientY
    const startDayIdx = getDayIdxFromX(startClientX)
    const startY = getYInGrid(startClientY)
    const pointerId = e.pointerId
    const timer = setTimeout(() => {
      if (!pendingTouchRef.current) return
      pendingTouchRef.current = null
      try {
        gridRef.current?.setPointerCapture(pointerId)
      } catch {
        return
      }
      if (scrollRef.current) scrollRef.current.style.overflowY = 'hidden'
      dragRef.current = { startDayIdx, startClientX, startClientY, startY, isDrag: true }
      setDragOverlays(computeOverlays(startDayIdx, startY, startDayIdx, startY))
      startAutoScroll(startClientX, startClientY)
      if (navigator.vibrate) navigator.vibrate(30)
    }, 500)
    pendingTouchRef.current = { pointerId, startClientX, startClientY, startDayIdx, startY, timer }
  }

  function handleGridPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'touch') return
    if (pendingTouchRef.current && !dragRef.current) {
      const dx = e.clientX - pendingTouchRef.current.startClientX
      const dy = e.clientY - pendingTouchRef.current.startClientY
      if (Math.sqrt(dx * dx + dy * dy) > 15) {
        clearTimeout(pendingTouchRef.current.timer)
        pendingTouchRef.current = null
      }
      return
    }
    if (!dragRef.current?.isDrag) return
    const endDayIdx = getDayIdxFromX(e.clientX)
    const endY = getYInGrid(e.clientY)
    setDragOverlays(computeOverlays(dragRef.current.startDayIdx, dragRef.current.startY, endDayIdx, endY))
    startAutoScroll(e.clientX, e.clientY)
  }

  function commitTouchDrag(clientX: number, clientY: number) {
    stopAutoScroll()
    if (!dragRef.current) return
    const { startDayIdx, startY } = dragRef.current
    dragRef.current = null
    setDragOverlays(new Map())
    if (scrollRef.current) scrollRef.current.style.overflowY = ''
    const endDayIdx = getDayIdxFromX(clientX)
    const endY = getYInGrid(clientY)
    let startDate: Date
    let endDate: Date
    if (startDayIdx < endDayIdx) {
      startDate = snapToGrid(days[startDayIdx], startY)
      endDate = snapToGrid(days[endDayIdx], endY)
    } else if (startDayIdx > endDayIdx) {
      startDate = snapToGrid(days[endDayIdx], endY)
      endDate = snapToGrid(days[startDayIdx], startY)
    } else {
      startDate = snapToGrid(days[startDayIdx], Math.min(startY, endY))
      endDate = snapToGrid(days[startDayIdx], Math.max(startY, endY))
    }
    if (endDate <= startDate) endDate.setMinutes(endDate.getMinutes() + 15)
    openCreate(formatDatetimeLocal(startDate), formatDatetimeLocal(endDate))
  }

  function handleGridPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'touch') return
    if (pendingTouchRef.current) {
      clearTimeout(pendingTouchRef.current.timer)
      pendingTouchRef.current = null
      return
    }
    commitTouchDrag(e.clientX, e.clientY)
  }

  function handleGridPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'touch') return
    stopAutoScroll()
    if (pendingTouchRef.current) {
      clearTimeout(pendingTouchRef.current.timer)
      pendingTouchRef.current = null
    }
    dragRef.current = null
    setDragOverlays(new Map())
    if (scrollRef.current) scrollRef.current.style.overflowY = ''
  }

  const allDayEvents = events.filter((e) => e.isAllDay && e.startAt)
  const calendarEvents = events.filter((e) => !e.isAllDay)

  return (
    <div className="flex flex-1 overflow-hidden">
      <RecommendationPanel
        date={formatDateInput(effectiveToday)}
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
          <span className="sm:hidden">{compactTitle(view, days)}</span>
          <span className="hidden sm:inline">{pageTitle(view, days)}</span>
        </h1>

        <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
          <button
            onClick={goToday}
            className="h-8 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted transition-colors"
          >
            Today
          </button>

          <input
            type="date"
            value={formatDateInput(current)}
            onChange={(e) => {
              const d = new Date(e.target.value + 'T00:00:00')
              if (!isNaN(d.getTime())) setCurrent(d)
            }}
            className="hidden sm:block h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring"
          />

          {/* View dropdown */}
          <div className="relative" ref={viewDropRef}>
            <button
              onClick={() => setViewDropOpen((o) => !o)}
              className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              {view === 'day' ? 'Day' : view === '3day' ? '3 Days' : 'Week'}
              <ChevronDown className="h-3 w-3 text-muted-foreground" strokeWidth={2} />
            </button>
            {viewDropOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 min-w-[80px] rounded-lg border border-border bg-card py-1 shadow-pop">
                {(['day', '3day', 'week'] as ViewMode[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => { setView(v); localStorage.setItem('stryde-calendar-view', v); setViewDropOpen(false) }}
                    className={`w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted ${
                      view === v ? 'font-semibold text-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    {v === 'day' ? 'Day' : v === '3day' ? '3 Days' : 'Week'}
                  </button>
                ))}
              </div>
            )}
          </div>

        </div>
      </header>

      {/* Time grid */}
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {/* Multi-day headers + all-day row — sticky, inside scroll container to share column widths */}
          {view !== 'day' && (
            <div className="sticky top-0 z-40 bg-background">
              <div className="flex border-b border-border">
                <div className="w-12 shrink-0" />
                {days.map((day) => (
                  <div
                    key={day.toISOString()}
                    className={`flex-1 border-l border-border py-2 text-center text-xs ${
                      isSameDay(day, effectiveToday) ? 'font-semibold text-primary' : 'text-muted-foreground'
                    }`}
                  >
                    {dayHeader(day)}
                  </div>
                ))}
              </div>
              {allDayEvents.length > 0 && (
                <div className="flex border-b border-border">
                  <div className="flex w-12 shrink-0 items-center justify-end pr-2 py-0.5">
                  </div>
                  {days.map((day, idx) => {
                    const ds = sod(day); const de = addDays(ds, 1)
                    const dayAll = allDayEvents.filter((e) => { const t = new Date(e.startAt!).getTime(); return t >= ds.getTime() && t < de.getTime() })
                    return (
                      <div key={day.toISOString()} className={`flex flex-1 flex-col gap-0.5 px-0.5 py-0.5 ${idx === 0 ? 'border-l border-border' : 'border-l border-border'}`}>
                        {dayAll.map((e) => (
                          <button key={e.id} onClick={() => openDetail(e)} className={`w-full truncate rounded-[3px] px-1.5 py-0.5 text-left text-[11px] font-medium leading-tight transition-opacity hover:opacity-80 ${e.status !== 'pending' ? 'opacity-50 line-through' : ''} ${eventAllDayColors(e).className}`} style={eventAllDayColors(e).style}>
                            {e.effectiveTitle}
                          </button>
                        ))}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Day view all-day row */}
          {view === 'day' && allDayEvents.some((e) => { const t = new Date(e.startAt!).getTime(); const ds = sod(days[0]).getTime(); return t >= ds && t < ds + 86400000 }) && (
            <div className="sticky top-0 z-40 flex border-b border-border bg-background">
              <div className="flex w-12 shrink-0 items-center justify-end pr-2 py-0.5">
                <span className="select-none text-[9px] leading-tight text-muted-foreground">all{'\n'}day</span>
              </div>
              <div className="flex flex-1 flex-col gap-0.5 border-l border-border px-0.5 py-0.5">
                {allDayEvents
                  .filter((e) => { const t = new Date(e.startAt!).getTime(); const ds = sod(days[0]).getTime(); return t >= ds && t < ds + 86400000 })
                  .map((e) => (
                    <button key={e.id} onClick={() => openDetail(e)} className={`w-full truncate rounded-[3px] px-1.5 py-0.5 text-left text-[11px] font-medium leading-tight transition-opacity hover:opacity-80 ${e.status !== 'pending' ? 'opacity-50 line-through' : ''} ${eventAllDayColors(e).className}`} style={eventAllDayColors(e).style}>
                      {e.effectiveTitle}
                    </button>
                  ))}
              </div>
            </div>
          )}

          <div className="flex" style={{ height: HOUR_PX * 24 }}>
            {/* Hour labels */}
            <div className="relative w-12 shrink-0">
              {Array.from({ length: 24 }, (_, h) => (
                <div
                  key={h}
                  className="absolute right-2 select-none text-[10px] leading-none text-muted-foreground"
                  style={{ top: h * HOUR_PX - 6 }}
                >
                  {h > 0 ? hourLabel(h) : ''}
                </div>
              ))}
            </div>

            {/* Day columns */}
            <div
              ref={gridRef}
              className="flex flex-1 min-w-0 cursor-crosshair select-none"
              onMouseDown={handleGridMouseDown}
              onPointerDown={handleGridPointerDown}
              onPointerMove={handleGridPointerMove}
              onPointerUp={handleGridPointerUp}
              onPointerCancel={handleGridPointerCancel}
            >
              {days.map((day, idx) => (
                <DayColumn
                  key={day.toISOString()}
                  day={day}
                  allEvents={calendarEvents}
                  onEventClick={openDetail}
                  overlay={dragOverlays.get(idx) ?? null}
                  moveOverlay={moveOverlay?.dayIdx === idx ? { topPx: moveOverlay.topPx, heightPx: moveOverlay.heightPx } : null}
                  resizeOverlay={resizeOverlay.get(idx) ?? null}
                  isToday={isSameDay(day, effectiveToday)}
                  borderLeft={idx === 0 || view !== 'day'}
                  onEventMoveStart={handleEventMoveStart}
                  onEventResizeStart={handleResizeStart}
                  suppressClickRef={suppressClickRef}
                  movingEventId={movingEventId}
                  resizingEventId={resizingEventId}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      </div>

      <EventDetailModal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        event={detailEvent}
        onEdit={(o) => { setDetailOpen(false); openEdit(o) }}
        onSchedule={(o) => { setDetailOpen(false); openSchedule(o) }}
      />

      <EventModal
        key={`${editingOccurrence?.id ?? defaultStartAt ?? defaultActivity?.id ?? 'new'}-${scheduleMode}`}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        occurrence={editingOccurrence}
        focusStartAt={focusStartAt}
        defaultStartAt={defaultStartAt}
        defaultEndAt={defaultEndAt}
        defaultActivity={defaultActivity}
        defaultMode={scheduleMode ? 'scheduled' : undefined}
      />
    </div>
  )
}
