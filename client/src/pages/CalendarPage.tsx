import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Menu, Plus, LayoutGrid, CalendarCheck } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { occurrencesApi, settingsApi } from '@/lib/api'
import { toastError } from '@/store/toasts'
import type { Activity, Occurrence } from '@/lib/types'
import type { ActivityTiming } from '@/components/recommendations/RecommendationStrip'
import { EventModal } from '@/components/events/EventModal'
import { EventDetailModal } from '@/components/events/EventDetailModal'
import { RecommendationPanel } from '@/components/recommendations/RecommendationStrip'

const DEFAULT_HOUR_PX = 64
const MIN_HOUR_PX = 32
const MAX_HOUR_PX = 128

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
  trueEndPx: number
}

function layoutDay(events: Occurrence[], day: Date, hourPx: number): LayoutEvent[] {
  const dayStartMs = sod(day).getTime()

  const items = events
    .filter((e) => !!e.startAt)
    .map((e) => {
      const startMs = new Date(e.startAt!).getTime()
      const endMs = e.endAt ? new Date(e.endAt).getTime() : startMs + 15 * 60 * 1000
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
      topPx: (s / 60) * hourPx,
      heightPx: Math.max(((end - s) / 60) * hourPx, 28),
      trueEndPx: (end / 60) * hourPx,
    }
  })
}

// ── Due occurrence helper ───────────────────────────────────────────────────

const DUE_PIN_HEIGHT = 18

function isDueOccurrence(o: Occurrence): boolean {
  return !!o.startAt && !o.endAt
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
  const { event, col, totalCols, topPx, heightPx, trueEndPx } = layout
  const { bgClass, bgHex, leftColor, textClass } = eventColors(event)
  const isDone = event.status === 'done'
  const isSkipped = event.status === 'skipped'
  const isPlanned = event.isPlanned
  const isDue = isDueOccurrence(event)
  const accentColor = event.activity.category ? event.activity.category.color : 'var(--color-primary)'
  const isHex = accentColor.startsWith('#')
  const accentFaded = isHex ? `${accentColor}18` : `color-mix(in srgb, ${accentColor} 9%, transparent)`
  const accentMid   = isHex ? `${accentColor}60` : `color-mix(in srgb, ${accentColor} 38%, transparent)`

  const GAP = 2
  const leftPct = (col / totalCols) * 100
  const widthPct = 100 / totalCols

  const timeText = event.startAt && !event.isPlanned
    ? `${timeLabel(event.startAt)}${event.endAt ? ` – ${timeLabel(event.endAt)}` : ''}`
    : ''

  const durationLabel = isPlanned && event.durationMinutes
    ? event.durationMinutes >= 60
      ? `~${Math.floor(event.durationMinutes / 60)}h${event.durationMinutes % 60 ? `${event.durationMinutes % 60}m` : ''}`
      : `~${event.durationMinutes}m`
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
      data-true-end-px={trueEndPx}
      style={{
        top: topPx + GAP,
        height: isDue ? DUE_PIN_HEIGHT : Math.max(heightPx - GAP, 20),
        left: `calc(${leftPct}% + ${GAP}px)`,
        width: `calc(${widthPct}% - ${GAP * 2}px)`,
        zIndex: isResizing ? 25 : undefined,
      }}
    >
      {isDue ? (
        /* Due pin — flat deadline marker, no resize handles */
        <button
          className={`absolute inset-0 flex items-center overflow-hidden rounded-[4px] text-left transition-opacity hover:opacity-80 cursor-grab active:cursor-grabbing ${isDone ? 'opacity-40' : isSkipped ? 'opacity-25' : ''}`}
          style={{
            border: isPlanned ? `1.5px dashed ${accentColor}` : `1px solid ${accentColor}`,
            backgroundColor: `${accentColor}18`,
            touchAction: 'pan-y',
          }}
          onPointerDown={bodyPointerProps.onPointerDown}
          onClick={bodyPointerProps.onClick}
        >
          <div style={{ width: 3, minWidth: 3, alignSelf: 'stretch', background: leftColor }} className="shrink-0" />
          <div className="flex min-w-0 flex-1 items-center gap-1 px-1.5">
            <p
              className={`min-w-0 flex-1 overflow-hidden whitespace-nowrap text-[10px] font-medium leading-none ${isDone ? 'line-through text-muted-foreground' : isSkipped ? 'text-muted-foreground' : ''}`}
              style={isDone || isSkipped ? undefined : { color: accentColor }}
            >
              {event.effectiveTitle}{durationLabel ? ` ${durationLabel}` : ''}
            </p>
            <span className="shrink-0 text-[9px] leading-none opacity-60" style={{ color: accentColor }}>
              {timeLabel(event.startAt!)}
            </span>
          </div>
        </button>
      ) : (
        <>
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
          {isPlanned ? (
            <button
              className={`absolute inset-0 overflow-hidden rounded-[4px] text-left transition-opacity hover:opacity-80 cursor-grab active:cursor-grabbing ${isDone ? 'opacity-40' : isSkipped ? 'opacity-25' : 'opacity-70'}`}
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
              className={`absolute inset-0 overflow-hidden rounded-[4px] border bg-card text-left transition-opacity hover:opacity-80 cursor-grab active:cursor-grabbing ${isDone ? 'opacity-50' : isSkipped ? 'opacity-30' : ''} ${isResizing ? 'border-primary/60 ring-1 ring-primary/40' : 'border-border/50'}`}
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
                        isDone ? 'line-through text-muted-foreground' : isSkipped ? 'text-muted-foreground/60' : textClass
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
        </>
      )}
    </div>
  )
}

// ── DayColumn ────────────────────────────────────────────────────────────────

// ── snapToGrid ──────────────────────────────────────────────────────────────

function snapToGrid(day: Date, yPx: number, hourPx: number): Date {
  const totalMin = (yPx / hourPx) * 60
  const hrs = Math.floor(totalMin / 60)
  const snapMins = Math.round((totalMin % 60) / 15) * 15
  const d = new Date(day)
  if (snapMins >= 60) {
    if (hrs >= 23) {
      // Past 23:52.5 → snap to midnight (start of next day)
      d.setDate(d.getDate() + 1)
      d.setHours(0, 0, 0, 0)
    } else {
      d.setHours(hrs + 1, 0, 0, 0)
    }
  } else {
    d.setHours(Math.min(hrs, 23), snapMins, 0, 0)
  }
  return d
}

function snapToGridDue(day: Date, yPx: number, hourPx: number): Date {
  const totalMin = (yPx / hourPx) * 60
  const hrs = Math.floor(totalMin / 60)
  const snapMins = Math.round((totalMin % 60) / 15) * 15
  const d = new Date(day)
  if (snapMins >= 60) {
    // Past 23:52.5 → snap to EOD instead of wrapping back to 23:00
    d.setHours(hrs >= 23 ? 23 : hrs + 1, hrs >= 23 ? 59 : 0, 0, 0)
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
  borderRight: boolean
  onEventMoveStart: (e: React.PointerEvent, event: Occurrence, topPx: number) => void
  onEventResizeStart: (e: React.PointerEvent, event: Occurrence, side: 'top' | 'bottom') => void
  suppressClickRef: { current: boolean }
  movingEventId: string | null
  resizingEventId: string | null
  hourPx: number
}

function DayColumn({ day, allEvents, onEventClick, overlay, moveOverlay, resizeOverlay, isToday, borderLeft, borderRight, onEventMoveStart, onEventResizeStart, suppressClickRef, movingEventId, resizingEventId, hourPx }: DayColumnProps) {
  const dayStart = sod(day)
  const dayEnd = addDays(dayStart, 1)

  const dayEvents = useMemo(
    () =>
      allEvents.filter((e) => {
        if (!e.startAt) return false
        const startMs = new Date(e.startAt).getTime()
        // Events without endAt are point-in-time due pins — only show in the day their start falls in
        if (!e.endAt) return startMs >= dayStart.getTime() && startMs < dayEnd.getTime()
        const endMs = new Date(e.endAt).getTime()
        return startMs < dayEnd.getTime() && endMs > dayStart.getTime()
      }),
    [allEvents, dayStart.getTime(), dayEnd.getTime()],
  )

  const layout = useMemo(() => layoutDay(dayEvents, day, hourPx), [dayEvents, day, hourPx])

  const now = new Date()
  const nowPx = ((now.getHours() * 60 + now.getMinutes()) / 60) * hourPx

  return (
    <div
      className={`relative flex-1 ${borderLeft ? 'border-l border-border' : ''} ${borderRight ? 'border-r border-border' : ''}`}
      style={{ minHeight: hourPx * 24 }}
    >
      {/* Hour lines — skip h=0, sticky header border-b already provides that separator */}
      {Array.from({ length: 24 }, (_, h) => h > 0 && (
        <div
          key={h}
          className="absolute inset-x-0 border-t border-border"
          style={{ top: h * hourPx }}
        />
      ))}
      {/* Half-hour lines */}
      {Array.from({ length: 24 }, (_, h) => (
        <div
          key={`hh${h}`}
          className="absolute inset-x-0 border-t border-border/40"
          style={{ top: h * hourPx + hourPx / 2 }}
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

// ── FloatingTasksRow ─────────────────────────────────────────────────────────

type FloatingDragInfo = { pointerId: number; clientX: number; clientY: number; pointerType: string }

function FloatingTasksRow({
  tasks,
  onSchedule,
  onDragStart,
}: {
  tasks: Occurrence[]
  onSchedule: (o: Occurrence) => void
  onDragStart?: (info: FloatingDragInfo, o: Occurrence) => void
}) {
  const scrollElRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollElRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      if (!el) return
      const canScrollH = el.scrollWidth > el.clientWidth
      if (!canScrollH) return
      e.preventDefault()
      e.stopPropagation()
      el.scrollLeft += e.deltaY + e.deltaX
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const pendingRef = useRef<{
    timer: ReturnType<typeof setTimeout>
    pointerId: number
    startX: number
    startY: number
    scrollStart: number
    scrolling: boolean
    occ: Occurrence
    pointerType: string
  } | null>(null)

  function cancelPending() {
    if (!pendingRef.current) return
    clearTimeout(pendingRef.current.timer)
    pendingRef.current = null
  }

  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>, o: Occurrence) {
    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return
      onDragStart?.({ pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY, pointerType: e.pointerType }, o)
      return
    }
    if (!onDragStart) return
    const { pointerId, clientX, clientY, pointerType } = e
    const scrollStart = scrollElRef.current?.scrollLeft ?? 0
    const timer = setTimeout(() => {
      const p = pendingRef.current
      pendingRef.current = null
      if (!p) return
      if (navigator.vibrate) navigator.vibrate(30)
      onDragStart({ pointerId, clientX, clientY, pointerType }, o)
    }, 350)
    pendingRef.current = { timer, pointerId, startX: clientX, startY: clientY, scrollStart, scrolling: false, occ: o, pointerType }
  }

  function handlePointerMove(e: React.PointerEvent) {
    const p = pendingRef.current
    if (!p || e.pointerId !== p.pointerId) return
    const dx = e.clientX - p.startX
    const dy = e.clientY - p.startY
    if (p.scrolling) {
      if (scrollElRef.current) scrollElRef.current.scrollLeft = p.scrollStart - dx
      return
    }
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return
    if (Math.abs(dx) >= Math.abs(dy)) {
      // Horizontal — cancel hold timer, scroll manually
      clearTimeout(p.timer)
      p.scrolling = true
      if (scrollElRef.current) scrollElRef.current.scrollLeft = p.scrollStart - dx
    }
    // Vertical movement: let the hold timer fire
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (pendingRef.current?.pointerId === e.pointerId) cancelPending()
  }

  if (tasks.length === 0) return null
  return (
    <div
      className="flex border-b border-border"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={cancelPending}
    >
      <div className="w-12 shrink-0 flex items-center justify-end pr-2 py-1">
        <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Float</span>
      </div>
      <div ref={scrollElRef} className="flex-1 overflow-x-auto border-l border-border" style={{ scrollbarWidth: 'none' }}>
        <div className="flex gap-1 px-1 py-1">
          {tasks.map((o) => {
            const { className, style } = eventAllDayColors(o)
            return (
              <button
                key={o.id}
                onPointerDown={(e) => handlePointerDown(e, o)}
                onClick={() => onSchedule(o)}
                className={`shrink-0 max-w-[160px] truncate rounded-[3px] px-1.5 py-0.5 text-left text-[11px] font-medium leading-tight transition-opacity hover:opacity-80 cursor-grab active:cursor-grabbing select-none ${className}`}
                style={{ touchAction: 'none', ...style }}
              >
                {o.effectiveTitle}
              </button>
            )
          })}
        </div>
      </div>
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
  const [current, setCurrent] = useState(() => {
    const saved = localStorage.getItem('stryde-calendar-view')
    const d = new Date()
    return saved === 'week' ? startOfWeek(d) : d
  })
  const [modalOpen, setModalOpen] = useState(false)
  const [editingOccurrence, setEditingOccurrence] = useState<Occurrence | undefined>()
  const [defaultStartAt, setDefaultStartAt] = useState<string | undefined>()
  const [defaultEndAt, setDefaultEndAt] = useState<string | undefined>()
  const [defaultActivity, setDefaultActivity] = useState<Activity | undefined>()
  const [focusStartAt, setFocusStartAt] = useState(false)
  const [scheduleMode, setScheduleMode] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailEvent, setDetailEvent] = useState<Occurrence | null>(null)
  const [duplicateFromOccurrence, setDuplicateFromOccurrence] = useState<Occurrence | undefined>()
  const [scrollTop, setScrollTop] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const timeGridRef = useRef<HTMLDivElement>(null)
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
  const [pendingAllDayDragId, setPendingAllDayDragId] = useState<string | null>(null)
  const [resizingEventId, setResizingEventId] = useState<string | null>(null)
  const [resizeOverlay, setResizeOverlay] = useState<Map<number, { topPx: number; heightPx: number }>>(() => new Map())
  const resizeDragActiveRef = useRef(false)
  const dateInputRef = useRef<HTMLInputElement>(null)
  const resizeStateRef = useRef<{
    origStartMs: number
    origEndMs: number
    side: 'top' | 'bottom'
  } | null>(null)
  const swipeRef = useRef<{ direction: 'horizontal' | 'vertical'; startX: number } | null>(null)
  const allDayDragStateRef = useRef<{ durationMinutes: number; curDayIdx: number } | null>(null)
  const allDayDragActiveRef = useRef(false)

  const [hourPx, setHourPx] = useState(() => {
    const saved = localStorage.getItem('stryde-calendar-zoom')
    const n = saved ? parseInt(saved, 10) : DEFAULT_HOUR_PX
    return isNaN(n) ? DEFAULT_HOUR_PX : Math.min(MAX_HOUR_PX, Math.max(MIN_HOUR_PX, n))
  })
  const hourPxRef = useRef(hourPx)
  hourPxRef.current = hourPx
  const pinchActiveRef = useRef(false)

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
    return Array.from({ length: 7 }, (_, i) => addDays(sod(current), i))
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

  const { data: floatingTasks = [] } = useQuery({
    queryKey: ['events', 'floating'],
    queryFn: () => occurrencesApi.list({ floating: true, status: 'pending' }),
    staleTime: 30 * 1000,
  })

  // Scroll to current time once the grid first becomes visible. Gated on
  // isLoading rather than mount: on a true first load the scroll container
  // doesn't exist yet (the spinner renders in its place), so a mount-only
  // effect silently no-ops until a later, cache-warm visit.
  const hasScrolledToNowRef = useRef(false)
  useEffect(() => {
    if (hasScrolledToNowRef.current || isLoading || !scrollRef.current) return
    const now = new Date()
    const px = ((now.getHours() * 60 + now.getMinutes()) / 60) * hourPxRef.current
    const top = Math.max(0, px - 200)
    scrollRef.current.scrollTop = top
    setScrollTop(top)
    hasScrolledToNowRef.current = true
  }, [isLoading])

  useEffect(() => {
    const el = dateInputRef.current
    if (!el) return
    const handler = (e: WheelEvent) => e.preventDefault()
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  useEffect(() => {
    if (!viewDropOpen) return
    function close(e: MouseEvent) {
      if (viewDropRef.current && !viewDropRef.current.contains(e.target as Node)) setViewDropOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [viewDropOpen])

  // A long-press in the Android WebView triggers the native context-menu /
  // text-selection gesture, which steals the pointer (pointercancel) before our
  // long-press timer fires. Suppressing contextmenu inside the calendar area
  // keeps the pointer stream alive so hold-to-resize and hold-to-drag work.
  useEffect(() => {
    function onContextMenu(e: Event) {
      if (scrollRef.current?.contains(e.target as Node)) e.preventDefault()
    }
    document.addEventListener('contextmenu', onContextMenu)
    return () => document.removeEventListener('contextmenu', onContextMenu)
  }, [])

  // Ctrl+wheel zoom (desktop)
  useEffect(() => {
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return
      if (!scrollRef.current?.contains(e.target as Node)) return
      e.preventDefault()
      const old = hourPxRef.current
      const delta = e.deltaY > 0 ? -8 : 8
      const next = Math.min(MAX_HOUR_PX, Math.max(MIN_HOUR_PX, old + delta))
      if (next === old) return
      const rect = scrollRef.current!.getBoundingClientRect()
      const relY = e.clientY - rect.top
      const timePos = (scrollRef.current!.scrollTop + relY) / old
      hourPxRef.current = next
      setHourPx(next)
      localStorage.setItem('stryde-calendar-zoom', String(next))
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, timePos * next - relY)
      })
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

  // Pinch-to-zoom (mobile)
  useEffect(() => {
    const ptrs = new Map<number, { x: number; y: number }>()
    let lastDist = 0

    function onDown(e: PointerEvent) {
      if (!scrollRef.current?.contains(e.target as Node)) return
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()]
        lastDist = Math.hypot(a.x - b.x, a.y - b.y)
        pinchActiveRef.current = true
        swipeRef.current = null
        if (pendingTouchRef.current) {
          clearTimeout(pendingTouchRef.current.timer)
          pendingTouchRef.current = null
        }
      }
    }

    function onMove(e: PointerEvent) {
      if (!ptrs.has(e.pointerId)) return
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (ptrs.size !== 2 || lastDist === 0) return
      const [a, b] = [...ptrs.values()]
      const newDist = Math.hypot(a.x - b.x, a.y - b.y)
      const ratio = newDist / lastDist
      lastDist = newDist
      if (Math.abs(ratio - 1) < 0.005) return
      const old = hourPxRef.current
      const next = Math.min(MAX_HOUR_PX, Math.max(MIN_HOUR_PX, Math.round(old * ratio)))
      if (next === old) return
      const pts = [...ptrs.values()]
      const midY = (pts[0].y + pts[1].y) / 2
      const rect = scrollRef.current!.getBoundingClientRect()
      const relY = midY - rect.top
      const timePos = (scrollRef.current!.scrollTop + relY) / old
      hourPxRef.current = next
      setHourPx(next)
      localStorage.setItem('stryde-calendar-zoom', String(next))
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, timePos * next - relY)
      })
    }

    function onUp(e: PointerEvent) {
      ptrs.delete(e.pointerId)
      if (ptrs.size < 2) lastDist = 0
      if (ptrs.size === 0) pinchActiveRef.current = false
    }

    // Capture phase: event blocks and resize handles stopPropagation() on
    // pointerdown for their own drag handling, which silences bubble-phase
    // window listeners — a pinch with a finger starting on an event was never
    // tracked. Capture runs before any of that.
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
    }
  }, [])

  function prev() {
    const step = view === 'day' ? -1 : view === '3day' ? -3 : -7
    setCurrent((d) => addDays(d, step))
  }

  function next() {
    const step = view === 'day' ? 1 : view === '3day' ? 3 : 7
    setCurrent((d) => addDays(d, step))
  }

  function goToday() {
    setCurrent(view === 'week' ? startOfWeek(effectiveToday) : effectiveToday)
  }

  function openFromActivity(activity: Activity, timing?: ActivityTiming) {
    setDuplicateFromOccurrence(undefined)
    setEditingOccurrence(undefined)
    setDefaultActivity(activity)
    setFocusStartAt(true)
    setScheduleMode(false)

    if (timing?.startTime) {
      const [h, m] = timing.startTime.split(':').map(Number)
      const start = new Date()
      start.setHours(h, m, 0, 0)
      const startStr = formatDatetimeLocal(start)
      setDefaultStartAt(startStr)
      setDefaultEndAt(
        timing.durationMinutes
          ? formatDatetimeLocal(new Date(start.getTime() + timing.durationMinutes * 60000))
          : undefined,
      )
    } else {
      setDefaultStartAt(undefined)
      setDefaultEndAt(undefined)
    }

    setModalOpen(true)
  }

  function openCreate(startAt?: string, endAt?: string) {
    setDuplicateFromOccurrence(undefined)
    setDefaultActivity(undefined)
    setEditingOccurrence(undefined)
    setDefaultStartAt(startAt)
    setDefaultEndAt(endAt)
    setFocusStartAt(false)
    setScheduleMode(false)
    setModalOpen(true)
  }

  function openDuplicate(o: Occurrence) {
    setDetailOpen(false)
    setDetailEvent(null)
    setEditingOccurrence(undefined)
    setDefaultActivity(undefined)
    setDefaultStartAt(undefined)
    setDefaultEndAt(undefined)
    setDuplicateFromOccurrence(o)
    setFocusStartAt(false)
    setScheduleMode(false)
    setModalOpen(true)
  }

  function openDetail(o: Occurrence) {
    setDetailEvent(o)
    setDetailOpen(true)
  }

  function openEdit(o: Occurrence) {
    setDuplicateFromOccurrence(undefined)
    setDefaultActivity(undefined)
    setEditingOccurrence(o)
    setDefaultStartAt(undefined)
    setDefaultEndAt(undefined)
    setFocusStartAt(!o.startAt)
    setScheduleMode(false)
    setModalOpen(true)
  }

  function openSchedule(o: Occurrence) {
    setDuplicateFromOccurrence(undefined)
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
    if (!event.startAt) return
    if (pinchActiveRef.current) return
    // Click suppression lasts until the next pointerdown: in the WebView the
    // click can arrive long after the gesture that set the flag (e.g. the finger
    // lifts well after a pointercancel), so a same-tick setTimeout(0) reset
    // would expire before the click it is meant to block.
    suppressClickRef.current = false
    const isDue = isDueOccurrence(event)
    // Short events render with a minimum height that extends the block below
    // the event's true end time. A pointer landing in that overflow zone falls
    // through to the grid (no stopPropagation) so drag-to-create still works in
    // the slot right after the event. Due pins are exempt: their fixed pin
    // height routinely exceeds their 15-minute span.
    if (!isDue) {
      const block = (e.target as Element).closest('[data-true-end-px]') as HTMLElement | null
      const trueEndPx = block ? parseFloat(block.dataset.trueEndPx ?? '') : NaN
      if (getYInGrid(e.clientY) >= trueEndPx) return
    }
    // Dismiss any active touch resize mode when interacting with an event body
    if (resizingEventId) {
      setResizingEventId(null)
      if (resizingEventId === event.id) {
        suppressClickRef.current = true
        return
      }
    }
    e.stopPropagation()

    const startMs = new Date(event.startAt!).getTime()
    const endMs = event.endAt ? new Date(event.endAt).getTime() : startMs + 15 * 60 * 1000
    const durationMs = endMs - startMs
    const isTouch = e.pointerType === 'touch'
    const pointerId = e.pointerId
    const startClientX = e.clientX
    const startClientY = e.clientY
    const gridY = getYInGrid(startClientY)
    const offsetPx = gridY - topPx

    function startDragging(armClientX: number, armClientY: number) {
      eventMoveRef.current = { event, durationMs, offsetPx, isDragging: false }
      // Dim the event immediately on touch to confirm long-press registered
      if (isTouch) setMovingEventId(event.id)
      if (!isTouch) document.body.style.cursor = 'grabbing'

      function onPointerMove(mv: PointerEvent) {
        if (isTouch && mv.pointerId !== pointerId) return
        if (!eventMoveRef.current) return
        // A second finger landed and started a pinch: abandon the move drag
        if (pinchActiveRef.current) {
          cleanup()
          eventMoveRef.current = null
          setMoveOverlay(null)
          setMovingEventId(null)
          return
        }
        if (!eventMoveRef.current.isDragging) {
          // Movement threshold distinguishes click/hold-and-release from a drag.
          // Touch measures from the arm position: fingers jitter a few px during
          // a hold, and without the threshold that jitter marked the gesture as
          // a drag, so releasing never entered resize mode.
          const dx = mv.clientX - armClientX
          const dy = mv.clientY - armClientY
          if (Math.abs(dx) + Math.abs(dy) < 8) return
          if (!isTouch) document.body.style.cursor = 'grabbing'
          eventMoveRef.current.isDragging = true
          setMovingEventId(event.id)
        }
        const curY = getYInGrid(mv.clientY)
        // Due pins are a single point in time — snap directly to cursor, no grab-offset
        const anchorY = isDue ? curY : Math.max(0, curY - eventMoveRef.current.offsetPx)
        const curDayIdx = Math.max(0, Math.min(getDayIdxFromX(mv.clientX), days.length - 1))
        const startSnapped = isDue ? snapToGridDue(days[curDayIdx], anchorY, hourPxRef.current) : snapToGrid(days[curDayIdx], anchorY, hourPxRef.current)
        const startMin = startSnapped.getHours() * 60 + startSnapped.getMinutes()
        const durationMin = eventMoveRef.current.durationMs / 60000
        setMoveOverlay({
          dayIdx: curDayIdx,
          topPx: (startMin / 60) * hourPxRef.current,
          heightPx: isDue ? DUE_PIN_HEIGHT : Math.max((durationMin / 60) * hourPxRef.current, 20),
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
        // A pinch consumed this gesture: don't enter resize mode or reschedule
        if (pinchActiveRef.current) return
        if (!isDragging) {
          // Hold-and-release without drag: enter resize mode (touch only; mouse uses hover handles)
          if (isTouch) {
            suppressClickRef.current = true
            setResizingEventId(ev.id)
          }
          return
        }
        suppressClickRef.current = true
        const curY = getYInGrid(mu.clientY)
        const anchorY = isDue ? curY : Math.max(0, curY - off)
        const curDayIdx = Math.max(0, Math.min(getDayIdxFromX(mu.clientX), days.length - 1))
        const newStart = isDue ? snapToGridDue(days[curDayIdx], anchorY, hourPxRef.current) : snapToGrid(days[curDayIdx], anchorY, hourPxRef.current)
        const newEnd = new Date(newStart.getTime() + dur)
        const origStartMs = new Date(ev.startAt!).getTime()
        if (newStart.getTime() === origStartMs) return
        rescheduleEvent(ev, newStart, newEnd)
      }

      function onPointerCancel(pc: PointerEvent) {
        if (isTouch && pc.pointerId !== pointerId) return
        // Capture isDragging before nulling the ref — Capacitor/Android can fire
        // pointercancel after the long-press timer (late native gesture recognition).
        // If no movement occurred, treat it the same as onEarlyCancel: enter resize mode.
        const wasDragging = eventMoveRef.current?.isDragging ?? false
        cleanup()
        eventMoveRef.current = null
        setMoveOverlay(null)
        setMovingEventId(null)
        if (isTouch && !wasDragging) {
          suppressClickRef.current = true
          setResizingEventId(event.id)
        }
      }

      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
      window.addEventListener('pointercancel', onPointerCancel)
    }

    if (isTouch) {
      // Long-press (350ms) before drag activates, so normal taps/scrolls still work.
      // 350ms deliberately undercuts the Android WebView's ~400ms native long-press
      // recognizer: in the Capacitor app the native gesture would otherwise steal
      // the pointer (pointercancel) before the timer fires. The grid-level
      // contextmenu suppression (see effect above) blocks most of those takeovers;
      // onEarlyCancel below is the fallback for the ones that still get through.
      let lastClientX = startClientX
      let lastClientY = startClientY
      const pressedAt = Date.now()
      let timer: ReturnType<typeof setTimeout>

      function cancelEarly() {
        clearTimeout(timer)
        window.removeEventListener('pointermove', onEarlyMove)
        window.removeEventListener('pointerup', onEarlyUp)
        window.removeEventListener('pointercancel', onEarlyCancel)
      }

      function onEarlyMove(mv: PointerEvent) {
        if (mv.pointerId !== pointerId) return
        lastClientX = mv.clientX
        lastClientY = mv.clientY
        const dx = mv.clientX - startClientX
        const dy = mv.clientY - startClientY
        // Fingers drift during a hold on a real touchscreen; only movement past
        // 15px counts as scroll/swipe intent and kills the long-press.
        if (Math.sqrt(dx * dx + dy * dy) > 15) {
          cancelEarly()
          if (Math.abs(dx) > Math.abs(dy)) {
            swipeRef.current = { direction: 'horizontal', startX: startClientX }
          }
        }
      }

      function onEarlyUp(up: PointerEvent) {
        if (up.pointerId !== pointerId) return
        cancelEarly()
      }

      function onEarlyCancel(pc: PointerEvent) {
        if (pc.pointerId !== pointerId) return
        cancelEarly()
        // A cancel landing here had under 15px of drift (more already removed
        // this listener), so classify by hold time: the WebView claims a pan-y
        // scroll within its touch slop almost immediately, while its native
        // long-press recognizer cancels only after ~400ms. Treat a late cancel
        // as a successful long-press and enter resize mode directly.
        if (Date.now() - pressedAt < 250) return
        if (navigator.vibrate) navigator.vibrate(30)
        suppressClickRef.current = true
        setResizingEventId(event.id)
      }

      window.addEventListener('pointermove', onEarlyMove)
      window.addEventListener('pointerup', onEarlyUp)
      window.addEventListener('pointercancel', onEarlyCancel)

      timer = setTimeout(() => {
        window.removeEventListener('pointermove', onEarlyMove)
        window.removeEventListener('pointerup', onEarlyUp)
        window.removeEventListener('pointercancel', onEarlyCancel)
        // A second finger started a pinch during the hold: don't arm the drag
        if (pinchActiveRef.current) return
        if (navigator.vibrate) navigator.vibrate(30)
        startDragging(lastClientX, lastClientY)
      }, 350)
    } else {
      startDragging(startClientX, startClientY)
    }
  }

  function rescheduleEvent(ev: Occurrence, newStart: Date, newEnd: Date) {
    const newEndAt = ev.endAt ? newEnd.toISOString() : null
    // Cancel any in-flight refetch so it doesn't overwrite the optimistic update
    // when the user drags multiple times quickly.
    queryClient.cancelQueries({ queryKey: ['events'] })
    queryClient.setQueryData<Occurrence[]>(
      ['events', 'calendar', rangeStart.toISOString(), rangeEnd.toISOString()],
      (old) => old?.map((o) => {
        if (o.id !== ev.id) return o
        return { ...o, startAt: newStart.toISOString(), endAt: newEndAt }
      }),
    )
    occurrencesApi.update(ev.id, {
      title: ev.title,
      startAt: newStart.toISOString(),
      endAt: newEndAt,
      isAllDay: ev.isAllDay,
      isPlanned: ev.isPlanned,
      durationMinutes: ev.durationMinutes,
    }).catch((err) => {
      toastError(err, 'Could not reschedule the occurrence.')
    }).finally(() => {
      queryClient.invalidateQueries({ queryKey: ['events'] })
      queryClient.invalidateQueries({ queryKey: ['recommendations'] })
    })
  }

  function rescheduleFromAllDay(ev: Occurrence, newStart: Date, newEnd: Date) {
    queryClient.cancelQueries({ queryKey: ['events'] })
    queryClient.setQueryData<Occurrence[]>(
      ['events', 'calendar', rangeStart.toISOString(), rangeEnd.toISOString()],
      (old) => old?.map((o) => {
        if (o.id !== ev.id) return o
        return { ...o, startAt: newStart.toISOString(), endAt: newEnd.toISOString(), isAllDay: false }
      }),
    )
    occurrencesApi.update(ev.id, {
      title: ev.title,
      startAt: newStart.toISOString(),
      endAt: newEnd.toISOString(),
      isAllDay: false,
      isPlanned: ev.isPlanned,
      durationMinutes: ev.durationMinutes,
    }).catch((err) => {
      toastError(err, 'Could not reschedule the occurrence.')
    }).finally(() => {
      queryClient.invalidateQueries({ queryKey: ['events'] })
      queryClient.invalidateQueries({ queryKey: ['recommendations'] })
    })
  }

  function scheduleFloating(ev: Occurrence, newStart: Date, newEnd: Date) {
    queryClient.cancelQueries({ queryKey: ['events'] })
    queryClient.setQueryData<Occurrence[]>(
      ['events', 'floating'],
      (old) => old?.filter((o) => o.id !== ev.id),
    )
    queryClient.setQueryData<Occurrence[]>(
      ['events', 'calendar', rangeStart.toISOString(), rangeEnd.toISOString()],
      (old) => [...(old ?? []), { ...ev, startAt: newStart.toISOString(), endAt: newEnd.toISOString() }],
    )
    occurrencesApi.update(ev.id, {
      title: ev.title,
      startAt: newStart.toISOString(),
      endAt: newEnd.toISOString(),
      isAllDay: false,
      isPlanned: ev.isPlanned,
      durationMinutes: ev.durationMinutes,
    }).catch((err) => {
      toastError(err, 'Could not schedule the task.')
    }).finally(() => {
      queryClient.invalidateQueries({ queryKey: ['events'] })
      queryClient.invalidateQueries({ queryKey: ['recommendations'] })
    })
  }

  function handleAllDayPillMoveStart(e: React.PointerEvent, event: Occurrence, onDrop?: (ev: Occurrence, start: Date, end: Date) => void) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.stopPropagation()
    suppressClickRef.current = false

    const durationMinutes = event.durationMinutes ?? 60
    const durationMs = durationMinutes * 60 * 1000
    const heightPx = Math.max((durationMinutes / 60) * hourPxRef.current, 20)
    const pointerId = e.pointerId
    const isTouch = e.pointerType === 'touch'
    const startClientX = e.clientX
    const startClientY = e.clientY
    let isDragging = false
    setPendingAllDayDragId(event.id)

    function isInGrid(clientY: number) {
      if (!gridRef.current) return false
      return clientY >= gridRef.current.getBoundingClientRect().top
    }

    function onPointerMove(mv: PointerEvent) {
      if (isTouch && mv.pointerId !== pointerId) return
      if (!isDragging) {
        const dx = mv.clientX - startClientX
        const dy = mv.clientY - startClientY
        if (Math.abs(dx) + Math.abs(dy) < 8) return
        isDragging = true
        allDayDragActiveRef.current = true
        setMovingEventId(event.id)
        if (!isTouch) document.body.style.cursor = 'grabbing'
      }

      const curDayIdx = Math.max(0, Math.min(getDayIdxFromX(mv.clientX), days.length - 1))
      allDayDragStateRef.current = { durationMinutes, curDayIdx }

      if (isInGrid(mv.clientY)) {
        const curY = getYInGrid(mv.clientY)
        const startSnapped = snapToGrid(days[curDayIdx], curY, hourPxRef.current)
        const startMin = startSnapped.getHours() * 60 + startSnapped.getMinutes()
        setMoveOverlay({ dayIdx: curDayIdx, topPx: (startMin / 60) * hourPxRef.current, heightPx })
      } else {
        setMoveOverlay(null)
      }

      startAutoScroll(mv.clientX, mv.clientY)
    }

    function cleanup() {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      allDayDragActiveRef.current = false
      allDayDragStateRef.current = null
      document.body.style.cursor = ''
      stopAutoScroll()
      setPendingAllDayDragId(null)
    }

    function onPointerUp(mu: PointerEvent) {
      if (isTouch && mu.pointerId !== pointerId) return
      cleanup()
      setMoveOverlay(null)
      setMovingEventId(null)
      if (!isDragging) return
      suppressClickRef.current = true
      if (!isInGrid(mu.clientY)) return
      const curDayIdx = Math.max(0, Math.min(getDayIdxFromX(mu.clientX), days.length - 1))
      const newStart = snapToGrid(days[curDayIdx], getYInGrid(mu.clientY), hourPxRef.current)
      const newEnd = new Date(newStart.getTime() + durationMs)
      ;(onDrop ?? rescheduleFromAllDay)(event, newStart, newEnd)
    }

    function onPointerCancel(pc: PointerEvent) {
      if (isTouch && pc.pointerId !== pointerId) return
      cleanup()
      setMoveOverlay(null)
      setMovingEventId(null)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
  }

  // ── Event resize drag ──────────────────────────────────────────────────────

  function handleResizeStart(e: React.PointerEvent, event: Occurrence, side: 'top' | 'bottom') {
    if (!event.startAt) return
    e.stopPropagation()

    const origStartMs = new Date(event.startAt).getTime()
    const origEndMs = event.endAt ? new Date(event.endAt).getTime() : origStartMs + 15 * 60 * 1000

    resizeDragActiveRef.current = true
    resizeStateRef.current = { origStartMs, origEndMs, side }
    document.body.style.cursor = 'ns-resize'

    function overlayForPointer(clientX: number, clientY: number): Map<number, { topPx: number; heightPx: number }> {
      const curDay = days[Math.max(0, Math.min(getDayIdxFromX(clientX), days.length - 1))]
      const snappedMs = snapToGrid(curDay, Math.max(0, Math.min(getYInGrid(clientY), hourPxRef.current * 24 - 1)), hourPxRef.current).getTime()
      if (side === 'top') {
        return computeResizeOverlays(Math.min(snappedMs, origEndMs - 15 * 60 * 1000), origEndMs)
      } else {
        return computeResizeOverlays(origStartMs, Math.max(snappedMs, origStartMs + 15 * 60 * 1000))
      }
    }

    function onPointerMove(mv: PointerEvent) {
      // A second finger landed and started a pinch: abandon the resize drag
      if (pinchActiveRef.current) {
        cleanup()
        setResizeOverlay(new Map())
        return
      }
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
      const snappedMs = snapToGrid(curDay, Math.max(0, Math.min(curY, hourPxRef.current * 24 - 1)), hourPxRef.current).getTime()

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
    return Math.max(0, Math.min(clientY - rect.top, hourPxRef.current * 24 - 1))
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
        const s = snapToGrid(days[i], topY, hourPxRef.current)
        const en = snapToGrid(days[i], botY, hourPxRef.current)
        const dayStartMs = sod(days[i]).getTime()
        const hp = hourPxRef.current
        const topPx = (s.getTime() - dayStartMs) / 3600000 * hp
        const endPx = Math.min((en.getTime() - dayStartMs) / 3600000 * hp, hp * 24)
        result.set(i, { topPx, heightPx: Math.max(endPx - topPx, hp / 4) })
      } else if (i === minIdx) {
        const anchorY = startDayIdx < endDayIdx ? startY : endY
        const s = snapToGrid(days[i], anchorY, hourPxRef.current)
        const hp = hourPxRef.current
        const topPx = (s.getHours() * 60 + s.getMinutes()) / 60 * hp
        result.set(i, { topPx, heightPx: hp * 24 - topPx })
      } else if (i === maxIdx) {
        const anchorY = startDayIdx > endDayIdx ? startY : endY
        const en = snapToGrid(days[i], anchorY, hourPxRef.current)
        const hp = hourPxRef.current
        const endPx = (en.getHours() * 60 + en.getMinutes()) / 60 * hp
        result.set(i, { topPx: 0, heightPx: Math.max(endPx, hp / 4) })
      } else {
        result.set(i, { topPx: 0, heightPx: hourPxRef.current * 24 })
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
        topPx: (startMin / 60) * hourPxRef.current,
        heightPx: Math.max(((endMin - startMin) / 60) * hourPxRef.current, 20),
      })
    }
    return result
  }

  function handleGridMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    // mousedown bubbles independently of pointerdown, so an event-move or resize
    // that already started via pointerdown would run concurrently. Bail out early.
    if (eventMoveRef.current || resizeDragActiveRef.current || allDayDragActiveRef.current) return
    if ((e.target as Element).closest('button')) {
      // Same minimum-height overflow carve-out as handleGridPointerDown: below
      // the event's true end the press belongs to the grid, not the event.
      const block = (e.target as Element).closest('[data-true-end-px]') as HTMLElement | null
      const trueEndPx = block ? parseFloat(block.dataset.trueEndPx ?? '99999') : 99999
      if (getYInGrid(e.clientY) < trueEndPx) return
    }
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
      // Drags can now start on an event's overflow zone; swallow the click the
      // browser fires on the underlying button so the detail modal doesn't open.
      suppressClickRef.current = true

      const endDayIdx = getDayIdxFromX(mu.clientX)
      const endY = getYInGrid(mu.clientY)

      let startDate: Date
      let endDate: Date
      if (startDayIdx < endDayIdx) {
        startDate = snapToGrid(days[startDayIdx], startY, hourPxRef.current)
        endDate = snapToGrid(days[endDayIdx], endY, hourPxRef.current)
      } else if (startDayIdx > endDayIdx) {
        startDate = snapToGrid(days[endDayIdx], endY, hourPxRef.current)
        endDate = snapToGrid(days[startDayIdx], startY, hourPxRef.current)
      } else {
        startDate = snapToGrid(days[startDayIdx], Math.min(startY, endY), hourPxRef.current)
        endDate = snapToGrid(days[startDayIdx], Math.max(startY, endY), hourPxRef.current)
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
      if (dragRef.current?.isDrag || eventMoveRef.current?.isDragging || resizeDragActiveRef.current || allDayDragActiveRef.current || swipeRef.current?.direction === 'horizontal' || pinchActiveRef.current) e.preventDefault()
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
      const anyDragActive = dragRef.current?.isDrag || eventMoveRef.current?.isDragging || resizeDragActiveRef.current || allDayDragActiveRef.current
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
          const isEvDue = isDueOccurrence(eventMoveRef.current.event)
          const autoAnchorY = isEvDue ? curY : anchorY
          const startSnapped = isEvDue ? snapToGridDue(days[curDayIdx], autoAnchorY, hourPxRef.current) : snapToGrid(days[curDayIdx], anchorY, hourPxRef.current)
          const startMin = startSnapped.getHours() * 60 + startSnapped.getMinutes()
          const durationMin = eventMoveRef.current.durationMs / 60000
          const hp = hourPxRef.current
          setMoveOverlay({
            dayIdx: curDayIdx,
            topPx: (startMin / 60) * hp,
            heightPx: isEvDue ? DUE_PIN_HEIGHT : Math.max((durationMin / 60) * hp, 20),
          })
        } else if (resizeDragActiveRef.current && resizeStateRef.current) {
          const rs = resizeStateRef.current
          const curDay = days[Math.max(0, Math.min(getDayIdxFromX(state.clientX), days.length - 1))]
          const snappedMs = snapToGrid(curDay, Math.max(0, Math.min(getYInGrid(state.clientY), hourPxRef.current * 24 - 1)), hourPxRef.current).getTime()
          if (rs.side === 'top') {
            setResizeOverlay(computeResizeOverlays(Math.min(snappedMs, rs.origEndMs - 15 * 60 * 1000), rs.origEndMs))
          } else {
            setResizeOverlay(computeResizeOverlays(rs.origStartMs, Math.max(snappedMs, rs.origStartMs + 15 * 60 * 1000)))
          }
        } else if (allDayDragActiveRef.current && allDayDragStateRef.current) {
          const { durationMinutes: dur, curDayIdx } = allDayDragStateRef.current
          if (gridRef.current && state.clientY >= gridRef.current.getBoundingClientRect().top) {
            const curY = getYInGrid(state.clientY)
            const startSnapped = snapToGrid(days[curDayIdx], curY, hourPxRef.current)
            const startMin = startSnapped.getHours() * 60 + startSnapped.getMinutes()
            const hp = hourPxRef.current
            setMoveOverlay({ dayIdx: curDayIdx, topPx: (startMin / 60) * hp, heightPx: Math.max((dur / 60) * hp, 20) })
          }
        }
      }
      state.rafId = requestAnimationFrame(tick)
    }
    state.rafId = requestAnimationFrame(tick)
  }

  function handleGridPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'touch') return
    if (pinchActiveRef.current) return
    const startClientX = e.clientX
    const startClientY = e.clientY
    const startDayIdx = getDayIdxFromX(startClientX)
    const startY = getYInGrid(startClientY)
    if ((e.target as Element).closest('button')) {
      // Allow drag creation in the minimum-height overflow zone below the event's true end time.
      // Short events get a visual minimum height (28px) that extends their button below their
      // actual end time; without this check the next 15-min slot appears unreachable.
      const block = (e.target as Element).closest('[data-true-end-px]') as HTMLElement | null
      const trueEndPx = block ? parseFloat(block.dataset.trueEndPx ?? '99999') : 99999
      if (startY < trueEndPx) return
    }
    const pointerId = e.pointerId
    const timer = setTimeout(() => {
      if (!pendingTouchRef.current) return
      pendingTouchRef.current = null
      swipeRef.current = null
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
    }, 350)
    pendingTouchRef.current = { pointerId, startClientX, startClientY, startDayIdx, startY, timer }
  }

  function handleGridPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'touch') return
    if (pendingTouchRef.current && !dragRef.current) {
      const dx = e.clientX - pendingTouchRef.current.startClientX
      const dy = e.clientY - pendingTouchRef.current.startClientY
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (swipeRef.current === null && dist > 5) {
        swipeRef.current = {
          direction: Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical',
          startX: pendingTouchRef.current.startClientX,
        }
      }
      if (dist > 15) {
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
    // Drags can now start on an event's overflow zone; swallow the click the
    // browser fires on the underlying button so the detail modal doesn't open.
    suppressClickRef.current = true
    if (scrollRef.current) scrollRef.current.style.overflowY = ''
    const endDayIdx = getDayIdxFromX(clientX)
    const endY = getYInGrid(clientY)
    let startDate: Date
    let endDate: Date
    if (startDayIdx < endDayIdx) {
      startDate = snapToGrid(days[startDayIdx], startY, hourPxRef.current)
      endDate = snapToGrid(days[endDayIdx], endY, hourPxRef.current)
    } else if (startDayIdx > endDayIdx) {
      startDate = snapToGrid(days[endDayIdx], endY, hourPxRef.current)
      endDate = snapToGrid(days[startDayIdx], startY, hourPxRef.current)
    } else {
      startDate = snapToGrid(days[startDayIdx], Math.min(startY, endY), hourPxRef.current)
      endDate = snapToGrid(days[startDayIdx], Math.max(startY, endY), hourPxRef.current)
    }
    if (endDate <= startDate) endDate.setMinutes(endDate.getMinutes() + 15)
    openCreate(formatDatetimeLocal(startDate), formatDatetimeLocal(endDate))
  }

  function handleGridPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'touch') return
    if (pendingTouchRef.current) {
      clearTimeout(pendingTouchRef.current.timer)
      pendingTouchRef.current = null
    }
    if (swipeRef.current?.direction === 'horizontal') {
      const dx = e.clientX - swipeRef.current.startX
      if (dx > 40) setCurrent((d) => addDays(d, -1))
      else if (dx < -40) setCurrent((d) => addDays(d, 1))
      swipeRef.current = null
      return
    }
    swipeRef.current = null
    commitTouchDrag(e.clientX, e.clientY)
  }

  function handleGridPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'touch') return
    swipeRef.current = null
    stopAutoScroll()
    if (pendingTouchRef.current) {
      clearTimeout(pendingTouchRef.current.timer)
      pendingTouchRef.current = null
    }
    dragRef.current = null
    setDragOverlays(new Map())
    if (scrollRef.current) scrollRef.current.style.overflowY = ''
  }

  const allDayEvents = events.filter((e) => e.isAllDay && e.startAt && e.status !== 'skipped')
  const calendarEvents = events.filter((e) => !e.isAllDay && e.status !== 'skipped')
  const dayAllDayEvents = useMemo(() => {
    const ds = sod(days[0]).getTime()
    return allDayEvents.filter((e) => { const t = new Date(e.startAt!).getTime(); return t >= ds && t < ds + 86400000 })
  }, [allDayEvents, days])

  const belowFoldDuePins = useMemo(() => {
    // Compute the scroll-content position of the time grid's top edge:
    // viewport_pos + scrollTop = scroll_content_pos (works even when the grid has scrolled above the viewport)
    const scrollRefTop = scrollRef.current?.getBoundingClientRect().top ?? 0
    const gridTop = timeGridRef.current?.getBoundingClientRect().top ?? scrollRefTop
    const gridOffset = gridTop - scrollRefTop + scrollTop
    const visibleBottom = scrollTop + (scrollRef.current?.clientHeight ?? 600)
    return calendarEvents
      .filter((e) => isDueOccurrence(e) && e.status === 'pending')
      .filter((e) => {
        const d = new Date(e.startAt!)
        const pinScrollPos = gridOffset + (d.getHours() + d.getMinutes() / 60) * hourPx
        return pinScrollPos > visibleBottom - DUE_PIN_HEIGHT
      })
      .sort((a, b) => new Date(a.startAt!).getTime() - new Date(b.startAt!).getTime())
  }, [calendarEvents, scrollTop, hourPx])

  return (
    <div className="flex flex-1 overflow-hidden">
      <RecommendationPanel
        date={formatDateInput(effectiveToday)}
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
          <span className="sm:hidden">{compactTitle(view, days)}</span>
          <span className="hidden sm:inline">{pageTitle(view, days)}</span>
        </h1>

        <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
          <button
            onClick={goToday}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-foreground hover:bg-muted transition-colors"
          >
            <CalendarCheck className="h-3.5 w-3.5" strokeWidth={2} />
          </button>

          <input
            ref={dateInputRef}
            type="date"
            value={formatDateInput(current)}
            onChange={(e) => {
              const d = new Date(e.target.value + 'T00:00:00')
              if (!isNaN(d.getTime())) setCurrent(view === 'week' ? startOfWeek(d) : d)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault()
            }}
            className="hidden sm:block h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring"
          />

          {/* View dropdown */}
          <div className="relative" ref={viewDropRef}>
            <button
              onClick={() => setViewDropOpen((o) => !o)}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-foreground hover:bg-muted transition-colors"
            >
              <LayoutGrid className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            {viewDropOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 min-w-[80px] rounded-lg border border-border bg-card py-1 shadow-pop">
                {(['day', '3day', 'week'] as ViewMode[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => { setView(v); localStorage.setItem('stryde-calendar-view', v); if (v === 'week') setCurrent((d) => startOfWeek(d)); setViewDropOpen(false) }}
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

          <button
            onClick={() => openCreate()}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-foreground hover:bg-muted transition-colors"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          </button>

        </div>
      </header>

      {/* Time grid */}
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto flex flex-col" style={{ WebkitTouchCallout: 'none' }} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
          {/* Multi-day headers + all-day row — sticky, inside scroll container to share column widths */}
          {view !== 'day' && (
            <div className="sticky top-0 z-40 bg-background">
              <div className="flex border-b border-border">
                <div className="w-12 shrink-0" />
                {days.map((day, dayIdx) => (
                  <div
                    key={day.toISOString()}
                    className={`flex-1 ${dayIdx === 0 ? 'border-l ' : ''}border-r border-border py-2 text-center text-xs ${
                      isSameDay(day, effectiveToday) ? 'font-semibold text-primary' : 'text-muted-foreground'
                    }`}
                  >
                    {dayHeader(day)}
                  </div>
                ))}
              </div>
              <FloatingTasksRow
                tasks={floatingTasks}
                onSchedule={(o) => { if (!suppressClickRef.current) openSchedule(o) }}
                onDragStart={(info, o) => handleAllDayPillMoveStart({ ...info, button: 0, stopPropagation: () => {} } as unknown as React.PointerEvent, o, scheduleFloating)}
              />
              {allDayEvents.length > 0 && (
                <div className="flex border-b border-border">
                  <div className="flex w-12 shrink-0 items-center justify-end pr-2 py-0.5">
                    <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Today</span>
                  </div>
                  {days.map((day, idx) => {
                    const ds = sod(day); const de = addDays(ds, 1)
                    const dayAll = allDayEvents.filter((e) => { const t = new Date(e.startAt!).getTime(); return t >= ds.getTime() && t < de.getTime() })
                    return (
                      <div key={day.toISOString()} className={`flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden px-0.5 py-0.5 ${idx === 0 ? 'border-l border-r border-border' : 'border-r border-border'}`}>
                        {dayAll.map((e) => (
                          <button key={e.id} onPointerDown={(ev) => handleAllDayPillMoveStart(ev, e)} onClick={() => { if (!suppressClickRef.current) openDetail(e) }} className={`w-full truncate rounded-[3px] px-1.5 py-0.5 text-left text-[11px] font-medium leading-tight transition-opacity hover:opacity-80 cursor-grab active:cursor-grabbing select-none ${e.status === 'done' ? 'opacity-50 line-through' : e.status === 'skipped' ? 'opacity-30' : movingEventId === e.id ? 'opacity-20' : pendingAllDayDragId === e.id ? 'opacity-50 scale-95' : ''} ${eventAllDayColors(e).className}`} style={{ touchAction: 'none', ...eventAllDayColors(e).style, ...(e.isPlanned ? { border: `1px dashed ${e.activity.category?.color ?? 'var(--color-primary)'}` } : undefined) }}>
                            {e.effectiveTitle}{e.durationMinutes ? ` ~${e.durationMinutes >= 60 ? `${Math.floor(e.durationMinutes / 60)}h${e.durationMinutes % 60 ? `${e.durationMinutes % 60}m` : ''}` : `${e.durationMinutes}m`}` : ''}
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
          {view === 'day' && (dayAllDayEvents.length > 0 || floatingTasks.length > 0) && (
            <div className="sticky top-0 z-40 bg-background">
              <FloatingTasksRow
                tasks={floatingTasks}
                onSchedule={(o) => { if (!suppressClickRef.current) openSchedule(o) }}
                onDragStart={(info, o) => handleAllDayPillMoveStart({ ...info, button: 0, stopPropagation: () => {} } as unknown as React.PointerEvent, o, scheduleFloating)}
              />
              {dayAllDayEvents.length > 0 && (
                <div className="flex border-b border-border">
                  <div className="w-12 shrink-0 flex items-center justify-end pr-2">
                  <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Today</span>
                </div>
                  <div className="flex flex-1 flex-col gap-0.5 border-l border-r border-border px-0.5 py-0.5">
                    {dayAllDayEvents.map((e) => (
                      <button key={e.id} onPointerDown={(ev) => handleAllDayPillMoveStart(ev, e)} onClick={() => { if (!suppressClickRef.current) openDetail(e) }} className={`w-full truncate rounded-[3px] px-1.5 py-0.5 text-left text-[11px] font-medium leading-tight transition-opacity hover:opacity-80 cursor-grab active:cursor-grabbing select-none ${e.status !== 'pending' ? 'opacity-50 line-through' : movingEventId === e.id ? 'opacity-20' : pendingAllDayDragId === e.id ? 'opacity-50 scale-95' : ''} ${eventAllDayColors(e).className}`} style={{ touchAction: 'none', ...eventAllDayColors(e).style }}>
                        {e.effectiveTitle}{e.durationMinutes ? ` ~${e.durationMinutes >= 60 ? `${Math.floor(e.durationMinutes / 60)}h${e.durationMinutes % 60 ? `${e.durationMinutes % 60}m` : ''}` : `${e.durationMinutes}m`}` : ''}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div ref={timeGridRef} className="flex flex-1" style={{ minHeight: hourPx * 24 }}>
            {/* Hour labels */}
            <div className="relative w-12 shrink-0">
              {Array.from({ length: 24 }, (_, h) => (
                <div
                  key={h}
                  className="absolute right-2 select-none text-[10px] leading-none text-muted-foreground"
                  style={{ top: h * hourPx - 6 }}
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
                  borderLeft={idx === 0}
                  borderRight={true}
                  onEventMoveStart={handleEventMoveStart}
                  onEventResizeStart={handleResizeStart}
                  suppressClickRef={suppressClickRef}
                  movingEventId={movingEventId}
                  resizingEventId={resizingEventId}
                  hourPx={hourPx}
                />
              ))}
            </div>
          </div>
          {belowFoldDuePins.length > 0 && (
            <div className="sticky bottom-0 z-40 flex border-t border-border bg-background">
              <div className="w-12 shrink-0 flex items-center justify-end pr-2 py-1">
                <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Due</span>
              </div>
              {days.map((day, idx) => {
                const ds = sod(day).getTime()
                const dayPins = belowFoldDuePins.filter((o) => {
                  const t = new Date(o.startAt!).getTime()
                  return t >= ds && t < ds + 86400000
                })
                return (
                  <div key={day.toISOString()} className={`flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden px-0.5 py-0.5 ${idx === 0 ? 'border-l border-r border-border' : 'border-r border-border'}`}>
                    {dayPins.map((o) => {
                      const accentColor = o.activity.category?.color ?? 'var(--color-primary)'
                      const leftColor = o.activity.category?.color ?? 'var(--color-border)'
                      const isHex = accentColor.startsWith('#')
                      const bgColor = isHex ? `${accentColor}18` : `color-mix(in srgb, ${accentColor} 9%, transparent)`
                      const time = new Date(o.startAt!).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
                      return (
                        <button
                          key={o.id}
                          onClick={() => openDetail(o)}
                          className="flex w-full items-center overflow-hidden rounded-[3px] text-left text-[11px] font-medium leading-tight transition-opacity hover:opacity-80"
                          style={{ border: `1px solid ${accentColor}`, backgroundColor: bgColor }}
                        >
                          <div style={{ width: 3, minWidth: 3, alignSelf: 'stretch', background: leftColor }} className="shrink-0" />
                          <div className="flex min-w-0 flex-1 items-center gap-1 px-1.5 py-0.5">
                            <p className="min-w-0 flex-1 truncate" style={{ color: accentColor }}>{o.effectiveTitle}</p>
                            <span className="shrink-0 text-[9px] leading-none opacity-60" style={{ color: accentColor }}>{time}</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      </div>

      <EventDetailModal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        event={detailEvent}
        onEdit={(o) => { setDetailOpen(false); openEdit(o) }}
        onSchedule={(o) => { setDetailOpen(false); openSchedule(o) }}
        onDuplicate={openDuplicate}
      />

      <EventModal
        key={`${editingOccurrence?.id ?? duplicateFromOccurrence?.id ?? defaultStartAt ?? defaultActivity?.id ?? 'new'}-${scheduleMode}-${editingOccurrence?.startAt ?? ''}`}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        occurrence={editingOccurrence}
        duplicateFrom={duplicateFromOccurrence}
        focusStartAt={focusStartAt}
        defaultStartAt={defaultStartAt}
        defaultEndAt={defaultEndAt}
        defaultActivity={defaultActivity}
        scheduleOnly={scheduleMode}
      />
    </div>
  )
}
