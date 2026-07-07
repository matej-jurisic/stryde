import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  action?: ReactNode
}

export function PageHeader({ title, action }: PageHeaderProps) {
  return (
    <header className="flex h-[57px] shrink-0 items-center justify-between border-b border-border px-4 md:px-6">
      <h1 className="text-base font-semibold text-foreground">{title}</h1>
      {action && <div>{action}</div>}
    </header>
  )
}
