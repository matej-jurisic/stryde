import { createPortal } from 'react-dom'
import { CircleAlert, CircleCheck, X } from 'lucide-react'
import { useToastStore } from '@/store/toasts'

export function Toasts() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  if (toasts.length === 0) return null

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-16 z-[100] flex flex-col items-center gap-2 px-4 md:bottom-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="pointer-events-auto flex w-full max-w-sm items-center gap-2.5 rounded-lg border border-border bg-card px-3.5 py-2.5 shadow-pop"
        >
          {t.tone === 'error' ? (
            <CircleAlert className="h-4 w-4 shrink-0 text-destructive" strokeWidth={2} />
          ) : (
            <CircleCheck className="h-4 w-4 shrink-0 text-primary" strokeWidth={2} />
          )}
          <p className="min-w-0 flex-1 text-sm text-foreground">{t.message}</p>
          <button
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  )
}
