import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal, type LucideIcon } from 'lucide-react'

export interface ActionMenuItem {
  icon?: LucideIcon
  label: string
  onClick: () => void
  destructive?: boolean
}

export type ActionMenuEntry = ActionMenuItem | 'separator'

interface ActionMenuProps {
  items: ActionMenuEntry[]
  disabled?: boolean
  /** Trigger button size; matches the row action buttons used across the app. */
  triggerClassName?: string
  iconClassName?: string
  ariaLabel?: string
}

/**
 * Icon-trigger dropdown menu rendered in a portal with fixed positioning,
 * so it can never be clipped by overflow containers. Flips above the trigger
 * when there is not enough room below.
 */
export function ActionMenu({
  items,
  disabled,
  triggerClassName = 'rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50',
  iconClassName = 'h-4 w-4',
  ariaLabel = 'More actions',
}: ActionMenuProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node
      if (buttonRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Position after the menu renders: measure its real height and flip upward
  // when it would clip below the viewport. Hidden until positioned.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !menuRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    const menuHeight = menuRef.current.offsetHeight
    const spaceBelow = window.innerHeight - rect.bottom - 8
    const top =
      spaceBelow >= menuHeight || rect.top < menuHeight + 8
        ? rect.bottom + 4
        : rect.top - menuHeight - 4
    setPos({ top, right: Math.max(8, window.innerWidth - rect.right) })
  }, [open])

  function toggle() {
    setPos(null)
    setOpen((o) => !o)
  }

  return (
    <>
      <button
        ref={buttonRef}
        onClick={toggle}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className={triggerClassName}
      >
        <MoreHorizontal className={iconClassName} strokeWidth={2} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{
              position: 'fixed',
              top: pos?.top ?? 0,
              right: pos?.right ?? 0,
              zIndex: 60,
              visibility: pos ? 'visible' : 'hidden',
            }}
            className="min-w-[160px] rounded-lg border border-border bg-card py-1 shadow-pop"
          >
            {items.map((item, i) =>
              item === 'separator' ? (
                <div key={`sep-${i}`} className="my-1 border-t border-border" />
              ) : (
                <button
                  key={item.label}
                  role="menuitem"
                  onClick={() => {
                    setOpen(false)
                    item.onClick()
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted ${
                    item.destructive ? 'text-destructive' : 'text-foreground'
                  }`}
                >
                  {item.icon && (
                    <item.icon
                      className={`h-3.5 w-3.5 shrink-0 ${item.destructive ? '' : 'text-muted-foreground'}`}
                      strokeWidth={2}
                    />
                  )}
                  {item.label}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
