import type { HTMLAttributes } from 'react'

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={`rounded-lg border border-border bg-card text-card-foreground ${className}`}
    />
  )
}

export function CardHeader({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`px-5 pt-5 pb-0 ${className}`} />
}

export function CardTitle({ className = '', ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 {...props} className={`text-base font-semibold text-foreground ${className}`} />
}

export function CardContent({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`px-5 py-5 ${className}`} />
}
