import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: ReactNode
  action?: ReactNode
  leading?: ReactNode
}

export function PageHeader({ title, action, leading }: PageHeaderProps) {
  return (
    <header className="flex h-[57px] shrink-0 items-center justify-between border-b border-border px-4 md:px-6">
      <div className="flex items-center gap-2">
        {leading}
        <h1 className="text-sm font-semibold text-foreground">{title}</h1>
      </div>
      {action && <div>{action}</div>}
    </header>
  )
}
