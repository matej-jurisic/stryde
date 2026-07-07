import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { eventsApi, settingsApi } from '@/lib/api'
import type { Event } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { EventModal } from '@/components/events/EventModal'
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
  return String(h).padStart(2, '0')
}

function timeLabel(iso: string): string {
  const d = new Date(iso)
  const h = d.getHours()
  const m = d.getMinutes()
  return m === 0 ? `${h}:00` : `${h}:${String(m).padStart(2, '0')}`
}

function pageTitle(view: 'day' | 'week', days: Date[]): string {
  if (view === 'day') {
    return days[0].toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  }
  const f = days[0]
  const l = days[6]
  if (f.getFullYear() !== l.getFullYear()) {
    return `${f.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - ${l.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
  }
  if (f.getMonth() !== l.getMonth()) {
    return `${f.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${l.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${l.getFullYear()}`
  }
  return `${f.toLocaleDateString('en-US', { month: 'long' })} ${f.getDate()} – ${l.getDate()}, ${l.getFullYear()}`
}

function dayHeader(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })
}

// ── Layout algorithm ────────────────────────────────────────────────────────

interface LayoutEvent {
  event: Event
  col: number
  totalCols: number
  topPx: number
  heightPx: number
}

function minOfDay(iso: string): number {
  const d = new Date(iso)
  return Math.min(d.getHours() * 60 + d.getMinutes(), 24 * 60 - 1)
}

function layoutDay(events: Event[]): LayoutEvent[] {
  const items = events
    .filter((e) => e.startAt)
    .map((e) => {
      const s = minOfDay(e.startAt!)
      const end = e.endAt ? Math.max(minOfDay(e.endAt), s + 15) : s + 30
      return { event: e, s, end: Math.min(end, 24 * 60) }
    })
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

type EventColors = { bg: string; leftColor: string; textClass: string }

function eventColors(event: Event, overdue: boolean): EventColors {
  if (overdue) {
    return {
      bg: 'bg-destructive/10',
      leftColor: 'var(--color-destructive)',
      textClass: 'text-destructive',
    }
  }
  const g = event.goals[0]
  if (!g) {
    return { bg: 'bg-muted', leftColor: 'var(--color-border)', textClass: 'text-foreground' }
  }
  switch (g.status) {
    case 'focus':
      return {
        bg: 'bg-goal-focus/10',
        leftColor: 'var(--color-goal-focus)',
        textClass: 'text-goal-focus',
      }
    case 'active':
      return {
        bg: 'bg-goal-active/10',
        leftColor: 'var(--color-goal-active)',
        textClass: 'text-goal-active',
      }
    default:
      return {
        bg: 'bg-goal-bench/10',
        leftColor: 'var(--color-goal-bench)',
        textClass: 'text-muted-foreground',
      }
  }
}

// ── EventBlock ──────────────────────────────────────────────────────────────

function EventBlock({
  layout,
  onClick,
}: {
  layout: LayoutEvent
  onClick: (e: Event) => void
}) {
  const { event, col, totalCols, topPx, heightPx } = layout
  const { bg, leftColor, textClass } = eventColors(event, event.isOverdue)
  const isDone = event.status !== 'pending'

  const GAP = 2
  const leftPct = (col / totalCols) * 100
  const widthPct = 100 / totalCols

  const timeText = event.startAt
    ? `${timeLabel(event.startAt)}${event.endAt ? ` – ${timeLabel(event.endAt)}` : ''}`
    : ''

  return (
    <button
      className={`absolute overflow-hidden rounded-[4px] border border-border/50 bg-card text-left transition-opacity hover:opacity-80 ${isDone ? 'opacity-50' : ''}`}
      style={{
        top: topPx + GAP,
        height: Math.max(heightPx - GAP, 20),
        left: `calc(${leftPct}% + ${GAP}px)`,
        width: `calc(${widthPct}% - ${GAP * 2}px)`,
      }}
      onClick={(e) => {
        e.stopPropagation()
        onClick(event)
      }}
    >
      <div className={`absolute inset-0 ${bg}`} />
      <div className="relative flex h-full">
        <div style={{ width: 3, minWidth: 3, background: leftColor }} className="shrink-0" />
        <div className="min-w-0 flex-1 px-1.5 py-0.5">
          <p
            className={`truncate text-[11px] font-medium leading-tight ${
              isDone ? 'line-through text-muted-foreground' : textClass
            }`}
          >
            {event.title}
          </p>
          {heightPx >= 44 && timeText && (
            <p className={`truncate text-[10px] leading-tight opacity-70 ${isDone ? 'text-muted-foreground' : textClass}`}>
              {timeText}
            </p>
          )}
        </div>
      </div>
    </button>
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
  allEvents: Event[]
  onEventClick: (e: Event) => void
  overlay: { topPx: number; heightPx: number } | null
  isToday: boolean
  borderLeft: boolean
}

function DayColumn({ day, allEvents, onEventClick, overlay, isToday, borderLeft }: DayColumnProps) {
  const dayStart = sod(day)
  const dayEnd = addDays(dayStart, 1)

  const dayEvents = useMemo(
    () =>
      allEvents.filter((e) => {
        if (!e.startAt) return false
        const t = new Date(e.startAt).getTime()
        return t >= dayStart.getTime() && t < dayEnd.getTime()
      }),
    [allEvents, dayStart.getTime(), dayEnd.getTime()],
  )

  const layout = useMemo(() => layoutDay(dayEvents), [dayEvents])

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
          className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
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
      {/* Event blocks */}
      {layout.map((l) => (
        <EventBlock key={l.event.id} layout={l} onClick={onEventClick} />
      ))}
    </div>
  )
}

// ── CalendarPage ─────────────────────────────────────────────────────────────

type ViewMode = 'day' | 'week'

export function CalendarPage() {
  const [view, setView] = useState<ViewMode>('day')
  const [current, setCurrent] = useState(() => new Date())
  const [modalOpen, setModalOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState<Event | undefined>()
  const [defaultStartAt, setDefaultStartAt] = useState<string | undefined>()
  const [defaultEndAt, setDefaultEndAt] = useState<string | undefined>()
  const [focusStartAt, setFocusStartAt] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    startDayIdx: number
    startClientX: number
    startClientY: number
    startY: number
    isDrag: boolean
  } | null>(null)
  const justDraggedRef = useRef(false)
  const touchStartRef = useRef<{ clientX: number; clientY: number } | null>(null)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const daysRef = useRef<Date[]>([])
  const [dragOverlays, setDragOverlays] = useState<Map<number, { topPx: number; heightPx: number }>>(
    () => new Map(),
  )

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
    const ws = startOfWeek(current)
    return Array.from({ length: 7 }, (_, i) => addDays(ws, i))
  }, [view, current])

  const rangeStart = days[0]
  const rangeEnd = addDays(days[days.length - 1], 1)

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['events', 'calendar', rangeStart.toISOString(), rangeEnd.toISOString()],
    queryFn: () =>
      eventsApi.list({
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

  daysRef.current = days

  // Non-passive touchmove so we can preventDefault during drag (blocks scroll)
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    function onTouchMove(e: TouchEvent) {
      const touch = e.touches[0]
      // Cancel hold if finger moves too far before timer fires
      if (holdTimerRef.current !== null) {
        if (!touchStartRef.current) return
        const dx = touch.clientX - touchStartRef.current.clientX
        const dy = touch.clientY - touchStartRef.current.clientY
        if (Math.sqrt(dx * dx + dy * dy) > 10) {
          clearTimeout(holdTimerRef.current)
          holdTimerRef.current = null
          touchStartRef.current = null
        }
        return
      }
      if (!dragRef.current?.isDrag) return
      e.preventDefault()
      const currentDays = daysRef.current
      if (!gridRef.current) return
      const rect = gridRef.current.getBoundingClientRect()
      const colWidth = rect.width / currentDays.length
      const endDayIdx = Math.max(0, Math.min(Math.floor((touch.clientX - rect.left) / colWidth), currentDays.length - 1))
      const endY = Math.max(0, Math.min(touch.clientY - rect.top, HOUR_PX * 24 - 1))
      const { startDayIdx, startY } = dragRef.current
      const minIdx = Math.min(startDayIdx, endDayIdx)
      const maxIdx = Math.max(startDayIdx, endDayIdx)
      const result = new Map<number, { topPx: number; heightPx: number }>()
      for (let i = minIdx; i <= maxIdx; i++) {
        if (startDayIdx === endDayIdx) {
          const topY = Math.min(startY, endY)
          const botY = Math.max(startY, endY)
          const s = snapToGrid(currentDays[i], topY)
          const en = snapToGrid(currentDays[i], botY)
          const topPx = ((s.getHours() * 60 + s.getMinutes()) / 60) * HOUR_PX
          const endPx = ((en.getHours() * 60 + en.getMinutes()) / 60) * HOUR_PX
          result.set(i, { topPx, heightPx: Math.max(endPx - topPx, HOUR_PX / 4) })
        } else if (i === minIdx) {
          const anchorY = startDayIdx < endDayIdx ? startY : endY
          const s = snapToGrid(currentDays[i], anchorY)
          const topPx = ((s.getHours() * 60 + s.getMinutes()) / 60) * HOUR_PX
          result.set(i, { topPx, heightPx: HOUR_PX * 24 - topPx })
        } else if (i === maxIdx) {
          const anchorY = startDayIdx > endDayIdx ? startY : endY
          const en = snapToGrid(currentDays[i], anchorY)
          const endPx = ((en.getHours() * 60 + en.getMinutes()) / 60) * HOUR_PX
          result.set(i, { topPx: 0, heightPx: Math.max(endPx, HOUR_PX / 4) })
        } else {
          result.set(i, { topPx: 0, heightPx: HOUR_PX * 24 })
        }
      }
      setDragOverlays(result)
    }
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => el.removeEventListener('touchmove', onTouchMove)
  }, [])

  function prev() {
    setCurrent((d) => addDays(d, view === 'day' ? -1 : -7))
  }

  function next() {
    setCurrent((d) => addDays(d, view === 'day' ? 1 : 7))
  }

  function goToday() {
    setCurrent(effectiveToday)
  }

  function openCreate(startAt?: string, endAt?: string) {
    setEditingEvent(undefined)
    setDefaultStartAt(startAt)
    setDefaultEndAt(endAt)
    setFocusStartAt(false)
    setModalOpen(true)
  }

  function openEdit(event: Event) {
    setEditingEvent(event)
    setDefaultStartAt(undefined)
    setDefaultEndAt(undefined)
    setFocusStartAt(!event.startAt)
    setModalOpen(true)
  }

  // ── Touch hold-to-drag (mobile) ──────────────────────────────────────────

  function handleGridTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    if ((e.target as Element).closest('button')) return
    const touch = e.touches[0]
    touchStartRef.current = { clientX: touch.clientX, clientY: touch.clientY }
    const dayIdx = getDayIdxFromX(touch.clientX)
    const y = getYInGrid(touch.clientY)
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null
      if (!touchStartRef.current) return
      dragRef.current = { startDayIdx: dayIdx, startClientX: touch.clientX, startClientY: touch.clientY, startY: y, isDrag: true }
      setDragOverlays(computeOverlays(dayIdx, y, dayIdx, y))
      if (navigator.vibrate) navigator.vibrate(30)
    }, 300)
  }

  function handleGridTouchEnd(e: React.TouchEvent<HTMLDivElement>) {
    touchStartRef.current = null
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
      return
    }
    if (!dragRef.current) return
    const { startDayIdx, startY } = dragRef.current
    dragRef.current = null
    setDragOverlays(new Map())
    const touch = e.changedTouches[0]
    const endDayIdx = getDayIdxFromX(touch.clientX)
    const endY = getYInGrid(touch.clientY)
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
    justDraggedRef.current = true
    openCreate(formatDatetimeLocal(startDate), formatDatetimeLocal(endDate))
  }

  function handleGridTouchCancel() {
    touchStartRef.current = null
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    dragRef.current = null
    setDragOverlays(new Map())
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

      justDraggedRef.current = true
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

  function handleGridClick(e: React.MouseEvent<HTMLDivElement>) {
    if ((e.target as Element).closest('button')) return
    if (justDraggedRef.current) {
      justDraggedRef.current = false
      return
    }
    const dayIdx = getDayIdxFromX(e.clientX)
    const y = getYInGrid(e.clientY)
    openCreate(formatDatetimeLocal(snapToGrid(days[dayIdx], y)))
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Recommendation panel — day view only */}
      {view === 'day' && (
        <RecommendationPanel
          date={formatDateInput(days[0])}
          onEventClick={openEdit}
          onNewEvent={() => openCreate()}
        />
      )}

      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
      {/* Header */}
      <header className="flex h-[57px] shrink-0 items-center gap-2 border-b border-border px-4 md:gap-3 md:px-6">
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
          {pageTitle(view, days)}
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

          {/* View toggle */}
          <div className="flex overflow-hidden rounded-md border border-border">
            <button
              onClick={() => setView('day')}
              className={`h-8 px-3 text-xs font-medium transition-colors ${
                view === 'day'
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/50'
              }`}
            >
              Day
            </button>
            <button
              onClick={() => setView('week')}
              className={`h-8 border-l border-border px-3 text-xs font-medium transition-colors ${
                view === 'week'
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/50'
              }`}
            >
              Week
            </button>
          </div>

          <Button size="sm" onClick={() => openCreate()} className="!px-2 sm:!px-3">
            <Plus className="h-3.5 w-3.5 sm:mr-1" strokeWidth={2.5} />
            <span className="hidden sm:inline">New Event</span>
          </Button>
        </div>
      </header>

      {/* Time grid */}
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {/* Week day headers — inside the scroll container so they share the same width as the columns */}
          {view === 'week' && (
            <div className="sticky top-0 z-10 flex border-b border-border bg-background">
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
              onClick={handleGridClick}
              onTouchStart={handleGridTouchStart}
              onTouchEnd={handleGridTouchEnd}
              onTouchCancel={handleGridTouchCancel}
            >
              {days.map((day, idx) => (
                <DayColumn
                  key={day.toISOString()}
                  day={day}
                  allEvents={events}
                  onEventClick={openEdit}
                  overlay={dragOverlays.get(idx) ?? null}
                  isToday={isSameDay(day, effectiveToday)}
                  borderLeft={idx === 0 || view === 'week'}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      </div>

      <EventModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        event={editingEvent}
        focusStartAt={focusStartAt}
        defaultStartAt={defaultStartAt}
        defaultEndAt={defaultEndAt}
      />
    </div>
  )
}
