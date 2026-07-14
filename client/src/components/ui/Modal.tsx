import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}

// Stack of open modals so Escape only closes the topmost one (e.g. a
// ConfirmDialog layered over an edit modal).
const modalStack: symbol[] = []

export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  const idRef = useRef<symbol | null>(null)
  if (idRef.current === null) idRef.current = Symbol('modal')

  useEffect(() => {
    if (!open) return
    const id = idRef.current!
    modalStack.push(id)
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === id) onClose()
    }
    document.addEventListener('keydown', handler)
    return () => {
      const idx = modalStack.indexOf(id)
      if (idx !== -1) modalStack.splice(idx, 1)
      document.removeEventListener('keydown', handler)
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center sm:p-4"
      aria-modal="true"
      role="dialog"
      aria-labelledby="modal-title"
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-modal-overlay"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="relative z-10 flex w-full flex-col overflow-hidden rounded-t-2xl border-t border-x border-border bg-background animate-modal-panel-up sm:rounded-xl sm:border sm:max-w-lg sm:animate-modal-panel"
        style={{
          boxShadow: 'var(--shadow-pop-value)',
          maxHeight: 'min(90vh, calc(100vh - 2.5rem))',
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
