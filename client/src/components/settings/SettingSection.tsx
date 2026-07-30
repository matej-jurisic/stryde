import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'

export { inputCls } from '@/components/ui/input'

/** Layout primitives shared by the Settings page and its per-section editors. */

export function SettingSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="overflow-hidden rounded-lg border border-border bg-card divide-y divide-border">
        {children}
      </div>
    </section>
  )
}

export function SettingRow({ label, hint, children }: { label: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  )
}

export function SectionFooter({ status, error, onSave, isPending, label = 'Save changes', children }: {
  status?: string
  error?: string | null
  onSave: () => void
  isPending: boolean
  label?: string
  children?: ReactNode
}) {
  return (
    <div className="flex items-center justify-end gap-3 bg-muted/40 px-4 py-3">
      {error && <span className="text-xs text-destructive">{error}</span>}
      {status && !error && <span className="text-xs text-muted-foreground">{status}</span>}
      {children}
      <Button size="sm" onClick={onSave} loading={isPending}>{label}</Button>
    </div>
  )
}
