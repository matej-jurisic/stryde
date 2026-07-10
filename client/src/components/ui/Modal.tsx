import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}

export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  const [kbOffset, setKbOffset] = useState(0)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // When the virtual keyboard opens the visual viewport shrinks; shift the modal
  // up by the keyboard height so it stays fully visible above the keyboard.
  useEffect(() => {
    if (!open) return
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setKbOffset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      setKbOffset(0)
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center sm:p-4"
      style={{ paddingBottom: `${kbOffset}px`, transition: 'padding-bottom 0.25s ease-out' }}
      aria-modal="true"
      role="dialog"
      aria-labelledby="modal-title"
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="relative z-10 flex w-full flex-col overflow-hidden rounded-t-2xl border-t border-x border-border bg-background sm:rounded-xl sm:border sm:max-w-lg"
        style={{
          boxShadow: 'var(--shadow-pop-value)',
          maxHeight: kbOffset > 0
            ? `calc(100vh - ${kbOffset}px - 2.5rem)`
            : 'min(90vh, calc(100vh - 2.5rem))',
          transition: 'max-height 0.25s ease-out',
        }}
      >
        {/* Drag handle — mobile only */}
        <div className="flex shrink-0 justify-center pt-2.5 sm:hidden">
          <div className="h-1 w-8 rounded-full bg-border" />
        </div>

        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <h2 id="modal-title" className="min-w-0 mr-3 text-base font-semibold text-foreground break-words">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex shrink-0 h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
          {children}
        </div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-4 pb-6 sm:pb-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
