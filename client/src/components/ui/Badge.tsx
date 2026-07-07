import type { HTMLAttributes } from 'react'

type Tone = 'neutral' | 'focus' | 'active' | 'bench' | 'red' | 'amber' | 'green'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

const toneClasses: Record<Tone, string> = {
  neutral: 'border border-border bg-muted text-muted-foreground',
  focus:   'border border-goal-focus bg-goal-focus/10 text-goal-focus',
  active:  'border border-goal-active bg-goal-active/10 text-goal-active',
  bench:   'border border-goal-bench bg-goal-bench/10 text-goal-bench',
  red:     'border border-red-300 bg-red-50 text-red-600',
  amber:   'border border-amber-300 bg-amber-50 text-amber-600',
  green:   'border border-green-300 bg-green-50 text-green-600',
}

export function Badge({ tone = 'neutral', className = '', ...props }: BadgeProps) {
  return (
    <span
      {...props}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${toneClasses[tone]} ${className}`}
    />
  )
}
