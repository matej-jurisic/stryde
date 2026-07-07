import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, GripVertical, CalendarPlus } from 'lucide-react'
import { recommendationsApi } from '@/lib/api'
import type { Event, Recommendation, GoalStatus } from '@/lib/types'
import { Badge } from '@/components/ui/Badge'

interface RecommendationPanelProps {
  date: string
  onEventClick: (event: Event) => void
  onNewEvent: () => void
}

function tierLabel(tier: number): string {
  if (tier === 1) return 'Due Today'
  if (tier === 2) return 'Overdue'
  if (tier === 3 || tier === 5) return 'Focus Goals'
  if (tier === 4 || tier === 6) return 'Active Goals'
  return 'Floating'
}

function goalTone(status: GoalStatus): 'focus' | 'active' | 'bench' {
  if (status === 'focus') return 'focus'
  if (status === 'active') return 'active'
  return 'bench'
}

function formatDuration(event: Event): string | null {
  if (!event.startAt || !event.endAt) return null
  const mins = Math.round(
    (new Date(event.endAt).getTime() - new Date(event.startAt).getTime()) / 60000,
  )
  if (mins <= 0) return null
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function RecItem({ event, onSchedule }: { event: Event; onSchedule: () => void }) {
  const primaryGoal =
    event.goals.find((g) => g.status === 'focus') ??
    event.goals.find((g) => g.status === 'active') ??
    event.goals[0]
  const duration = formatDuration(event)

  return (
    <li className="group flex items-start gap-2 rounded-lg border border-transparent px-2 py-2.5 transition-colors hover:border-border hover:bg-muted/40">
      <span className="mt-0.5 shrink-0 cursor-grab text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
        <GripVertical className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm text-foreground">{event.title}</p>
          {duration && (
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{duration}</span>
          )}
        </div>
        {primaryGoal && (
          <div className="mt-1.5">
            <Badge tone={goalTone(primaryGoal.status)} className="max-w-[160px] truncate block">
              {primaryGoal.title}
            </Badge>
          </div>
        )}
      </div>
      <button
        onClick={onSchedule}
        title={event.startAt ? 'Edit event' : 'Schedule event'}
        className="mt-0.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-primary"
      >
        <CalendarPlus className="h-4 w-4" />
      </button>
    </li>
  )
}

export function RecommendationPanel({ date, onEventClick, onNewEvent }: RecommendationPanelProps) {
  const { data: recommendations = [], isLoading } = useQuery({
    queryKey: ['recommendations', date],
    queryFn: () => recommendationsApi.list(date),
    staleTime: 30 * 1000,
  })

  const groups = useMemo(() => {
    const map = new Map<string, Recommendation[]>()
    const order: string[] = []
    for (const rec of recommendations) {
      const label = tierLabel(rec.tier)
      if (!map.has(label)) {
        map.set(label, [])
        order.push(label)
      }
      map.get(label)!.push(rec)
    }
    return order.map((label) => ({ label, items: map.get(label)! }))
  }, [recommendations])

  return (
    <section className="hidden md:flex w-80 shrink-0 flex-col overflow-hidden border-r border-border bg-background">
      <div className="shrink-0 px-5 py-5">
        <h1 className="text-lg font-semibold text-foreground">Recommendations</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Drag events onto your day to schedule.
        </p>
        <button
          onClick={onNewEvent}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-sm font-medium text-primary transition-colors hover:border-primary hover:bg-primary/5"
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          New Event
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : groups.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">
            Nothing to recommend right now.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-4">
              <div className="flex items-center justify-between px-2 py-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </h2>
                <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">
                  {group.items.length}
                </span>
              </div>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((rec) => (
                  <RecItem
                    key={rec.event.id}
                    event={rec.event}
                    onSchedule={() => onEventClick(rec.event)}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
