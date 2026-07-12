import type { GoalOccurrenceStats } from '@/lib/types'

interface OccurrenceBarProps {
  stats: GoalOccurrenceStats
  barClassName?: string
  labelClassName?: string
}

export function OccurrenceBar({ stats, barClassName = 'flex-1', labelClassName = 'w-7' }: OccurrenceBarProps) {
  const attempted = stats.done + stats.skipped
  if (attempted === 0 && stats.pending === 0) return null
  const donePct = attempted > 0 ? (stats.done / attempted) * 100 : 0
  const skippedPct = attempted > 0 ? (stats.skipped / attempted) * 100 : 0
  return (
    <>
      <div className={`flex h-1 overflow-hidden rounded-full bg-muted ${barClassName}`}>
        <div className="h-full bg-primary transition-all" style={{ width: `${donePct}%` }} />
        <div className="h-full bg-destructive/50 transition-all" style={{ width: `${skippedPct}%` }} />
      </div>
      <span className={`shrink-0 text-right font-mono text-[11px] text-muted-foreground ${labelClassName}`}>
        {attempted > 0 ? `${stats.done}/${attempted}` : `${stats.pending}p`}
      </span>
    </>
  )
}
