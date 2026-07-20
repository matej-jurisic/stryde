import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check, Search } from 'lucide-react'

export interface SelectOption {
  value: string
  label: string
  sublabel?: string
}

interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  error?: boolean
  disabled?: boolean
  onCreateNew?: () => void
  createNewLabel?: string
  className?: string
}

export function Select({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  error,
  disabled,
  onCreateNew,
  createNewLabel = '+ Create new',
  className = '',
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const [highlighted, setHighlighted] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const selected = options.find((o) => o.value === value)
  const filtered = search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options

  useEffect(() => {
    if (open) {
      const isTouchDevice = window.matchMedia('(pointer: coarse)').matches
      if (!isTouchDevice) setTimeout(() => searchRef.current?.focus(), 0)
    } else {
      setSearch('')
      setHighlighted(0)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || dropdownRef.current?.contains(t)) return
      setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
        return
      }
      const maxIdx = filtered.length - 1 + (onCreateNew ? 1 : 0)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlighted((h) => Math.min(h + 1, Math.max(0, maxIdx)))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlighted((h) => Math.max(h - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (highlighted < filtered.length) {
          onChange(filtered[highlighted].value)
          setOpen(false)
        } else if (onCreateNew && highlighted === filtered.length) {
          onCreateNew()
          setOpen(false)
        }
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, { capture: true })
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, { capture: true })
    }
  }, [open, filtered, highlighted, onChange, onCreateNew])

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !dropdownRef.current) return
    const trigger = triggerRef.current
    const dropdown = dropdownRef.current

    function reposition() {
      const rect = trigger.getBoundingClientRect()
      const dropH = dropdown.offsetHeight
      const vp = window.visualViewport
      const vpH = vp ? vp.height : window.innerHeight
      const vpW = vp ? vp.width : window.innerWidth
      const spaceBelow = vpH - rect.bottom - 8
      const top = spaceBelow >= dropH ? rect.bottom + 4 : rect.top - dropH - 4
      const left = Math.max(8, Math.min(rect.left, vpW - dropdown.offsetWidth - 8))
      setPos({ top, left, width: rect.width })
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
    if (disabled) return
    setPos(null)
    setOpen((o) => !o)
  }

  function select(v: string) {
    onChange(v)
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        disabled={disabled}
        className={`flex h-10 w-full items-center justify-between gap-2 rounded-lg border bg-background px-3 text-sm text-left transition-colors focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 ${
          error ? 'border-destructive' : 'border-input'
        } ${selected ? 'text-foreground' : 'text-muted-foreground'} ${className}`}
      >
        <span className="min-w-0 flex-1 truncate">{selected ? selected.label : placeholder}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: 'fixed',
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              width: pos ? Math.max(pos.width, 220) : 220,
              zIndex: 60,
              visibility: pos ? 'visible' : 'hidden',
            }}
            className="flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-pop"
          >
            <div className="border-b border-border px-2 py-2">
              <div className="flex items-center gap-1.5 rounded-md border border-input bg-background px-2">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value)
                    setHighlighted(0)
                  }}
                  placeholder="Search..."
                  className="h-8 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
            </div>

            <div className="max-h-52 overflow-y-auto py-1">
              {filtered.length === 0 && !onCreateNew && (
                <p className="px-3 py-2 text-sm text-muted-foreground">No results</p>
              )}
              {filtered.map((opt, i) => (
                <button
                  key={opt.value}
                  type="button"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => select(opt.value)}
                  onMouseEnter={() => setHighlighted(i)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                    i === highlighted ? 'bg-muted' : ''
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-foreground">{opt.label}</span>
                  {opt.sublabel && (
                    <span className="shrink-0 text-xs text-muted-foreground">{opt.sublabel}</span>
                  )}
                  {opt.value === value && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                  )}
                </button>
              ))}

              {onCreateNew && (
                <button
                  type="button"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onCreateNew()
                    setOpen(false)
                  }}
                  onMouseEnter={() => setHighlighted(filtered.length)}
                  className={`flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-primary transition-colors ${
                    highlighted === filtered.length ? 'bg-muted' : ''
                  }`}
                >
                  {createNewLabel}
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
