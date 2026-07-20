import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'

const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

interface Parsed {
  year: number
  month: number // 0-indexed
  day: number
  hour: number
  minute: number
}

function parse(value: string): Parsed | null {
  if (!value) return null
  const tIdx = value.indexOf('T')
  const datePart = tIdx === -1 ? value : value.slice(0, tIdx)
  const timePart = tIdx === -1 ? '' : value.slice(tIdx + 1)
  const [y, mo, d] = datePart.split('-').map(Number)
  if (!y || !mo || !d) return null
  const [h = 0, m = 0] = timePart ? timePart.split(':').map(Number) : []
  return { year: y, month: mo - 1, day: d, hour: h, minute: m }
}

function toLocalStr(year: number, month: number, day: number, hour: number, minute: number): string {
  const z = (n: number) => String(n).padStart(2, '0')
  return `${year}-${z(month + 1)}-${z(day)}T${z(hour)}:${z(minute)}`
}

function formatDisplay(value: string, mode: 'date' | 'datetime'): string {
  const p = parse(value)
  if (!p) return ''
  const d = new Date(p.year, p.month, p.day)
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  if (mode === 'date') return dateStr
  const ampm = p.hour >= 12 ? 'PM' : 'AM'
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12
  return `${dateStr} · ${h12}:${String(p.minute).padStart(2, '0')} ${ampm}`
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

// Monday-first: Mon=0 ... Sun=6
function firstDowOfMonth(year: number, month: number): number {
  return (new Date(year, month, 1).getDay() + 6) % 7
}

interface DateTimePickerProps {
  value: string // YYYY-MM-DDTHH:MM or ''
  onChange: (value: string) => void
  mode?: 'date' | 'datetime'
  placeholder?: string
  error?: boolean
  autoFocus?: boolean
  className?: string
}

export function DateTimePicker({
  value,
  onChange,
  mode = 'datetime',
  placeholder = 'Pick a date...',
  error,
  autoFocus,
  className = '',
}: DateTimePickerProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const parsed = parse(value)
  const now = new Date()

  const [viewYear, setViewYear] = useState(() => parsed?.year ?? now.getFullYear())
  const [viewMonth, setViewMonth] = useState(() => parsed?.month ?? now.getMonth())
  const [hour, setHour] = useState(() => parsed?.hour ?? 12)
  const [minute, setMinute] = useState(() => parsed?.minute ?? 0)

  useEffect(() => {
    const p = parse(value)
    if (p) {
      setViewYear(p.year)
      setViewMonth(p.month)
      setHour(p.hour)
      setMinute(p.minute)
    }
  }, [value])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, { capture: true })
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, { capture: true })
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !panelRef.current) return
    const trigger = triggerRef.current
    const panel = panelRef.current

    function reposition() {
      const rect = trigger.getBoundingClientRect()
      const panelH = panel.offsetHeight
      const panelW = panel.offsetWidth
      const vp = window.visualViewport
      const vpH = vp ? vp.height : window.innerHeight
      const vpW = vp ? vp.width : window.innerWidth
      const spaceBelow = vpH - rect.bottom - 8
      const top = spaceBelow >= panelH ? rect.bottom + 4 : rect.top - panelH - 4
      const left = Math.max(8, Math.min(rect.left, vpW - panelW - 8))
      setPos({ top, left })
    }

    reposition()

    const vp = window.visualViewport
    if (vp) {
      vp.addEventListener('resize', reposition)
      vp.addEventListener('scroll', reposition)
      return () => {
        vp.removeEventListener('resize', reposition)
        vp.removeEventListener('scroll', reposition)
      }
    }
    window.addEventListener('resize', reposition)
    return () => window.removeEventListener('resize', reposition)
  }, [open])

  function toggle() {
    setPos(null)
    setOpen((o) => !o)
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11) }
    else setViewMonth((m) => m - 1)
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0) }
    else setViewMonth((m) => m + 1)
  }

  function selectDay(day: number) {
    const h = mode === 'datetime' ? hour : 0
    const m = mode === 'datetime' ? minute : 0
    onChange(toLocalStr(viewYear, viewMonth, day, h, m))
    if (mode === 'date') setOpen(false)
  }

  function applyTime(h: number, m: number) {
    setHour(h)
    setMinute(m)
    if (parsed) onChange(toLocalStr(parsed.year, parsed.month, parsed.day, h, m))
  }

  function goToday() {
    const d = new Date()
    const h = mode === 'datetime' ? hour : 0
    const m = mode === 'datetime' ? minute : 0
    onChange(toLocalStr(d.getFullYear(), d.getMonth(), d.getDate(), h, m))
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
    if (mode === 'date') setOpen(false)
  }

  function clear() {
    onChange('')
    setOpen(false)
  }

  const numDays = daysInMonth(viewYear, viewMonth)
  const firstDow = firstDowOfMonth(viewYear, viewMonth)
  const selDay = parsed?.year === viewYear && parsed?.month === viewMonth ? parsed.day : null
  const todayY = now.getFullYear()
  const todayMo = now.getMonth()
  const todayD = now.getDate()

  const display = value ? formatDisplay(value, mode) : ''

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        autoFocus={autoFocus}
        className={`flex h-10 w-full items-center justify-between gap-2 rounded-lg border bg-background px-3 text-sm text-left transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
          error ? 'border-destructive' : 'border-input'
        } ${display ? 'text-foreground' : 'text-muted-foreground'} ${className}`}
      >
        <span className="min-w-0 flex-1 truncate">{display || placeholder}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: 'fixed',
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              zIndex: 60,
              visibility: pos ? 'visible' : 'hidden',
            }}
            className="w-72 overflow-hidden rounded-lg border border-border bg-card shadow-pop"
          >
            {/* Month navigation */}
            <div className="flex items-center justify-between px-3 py-3">
              <button
                type="button"
                onClick={prevMonth}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-sm font-semibold text-foreground">
                {MONTHS[viewMonth]} {viewYear}
              </span>
              <button
                type="button"
                onClick={nextMonth}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {/* Day-of-week headers */}
            <div className="grid grid-cols-7 px-2 pb-1">
              {DOW.map((d) => (
                <div
                  key={d}
                  className="flex h-7 items-center justify-center text-[11px] font-medium text-muted-foreground"
                >
                  {d}
                </div>
              ))}
            </div>

            {/* Day grid */}
            <div className="grid grid-cols-7 gap-y-0.5 px-2 pb-3">
              {Array.from({ length: firstDow }, (_, i) => <div key={`e${i}`} />)}
              {Array.from({ length: numDays }, (_, i) => {
                const day = i + 1
                const isSel = selDay === day
                const isToday = viewYear === todayY && viewMonth === todayMo && day === todayD
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => selectDay(day)}
                    className={`flex h-8 w-full items-center justify-center rounded-md text-sm transition-colors ${
                      isSel
                        ? 'bg-primary font-medium text-primary-foreground'
                        : isToday
                        ? 'font-semibold text-primary hover:bg-muted'
                        : 'text-foreground hover:bg-muted'
                    }`}
                  >
                    {day}
                  </button>
                )
              })}
            </div>

            {/* Time picker */}
            {mode === 'datetime' && (
              <div className="flex items-center gap-3 border-t border-border px-3 py-3">
                <span className="shrink-0 text-sm text-muted-foreground">Time</span>
                <div className="flex flex-1 items-center gap-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={String(hour).padStart(2, '0')}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const h = Math.min(23, Math.max(0, parseInt(e.target.value.replace(/\D/g, '')) || 0))
                      applyTime(h, minute)
                    }}
                    className="h-8 w-12 rounded-md border border-input bg-background text-center text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <span className="text-sm font-semibold text-foreground">:</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={String(minute).padStart(2, '0')}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const m = Math.min(59, Math.max(0, parseInt(e.target.value.replace(/\D/g, '')) || 0))
                      applyTime(hour, m)
                    }}
                    className="h-8 w-12 rounded-md border border-input bg-background text-center text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Done
                </button>
              </div>
            )}

            {/* Quick actions */}
            <div className="flex justify-between border-t border-border px-3 py-2">
              <button
                type="button"
                onClick={goToday}
                className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
              >
                Today
              </button>
              <button
                type="button"
                onClick={clear}
                className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Clear
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
