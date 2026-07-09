import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarPlus, Sparkles, X } from 'lucide-react'
import { recommendationsApi } from '@/lib/api'
import type { BaseEventSummary, Event, GoalStatus, Recommendation } from '@/lib/types'
import { Badge } from '@/components/ui/Badge'

interface RecommendationPanelProps {
  date: string
  onEventClick: (event: Event) => void
  onBaseEventClick: (baseEvent: BaseEventSummary) => void
  mobileOpen?: boolean
  onMobileClose?: () => void
}

function tierLabel(tier: number): string {
  if (tier === 1) return 'Focus Goals'
  if (tier === 2) return 'Active Goals'
  if (tier === 3) return 'Based on Your Habits'
  return 'Other'
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

function EventRecItem({ event, onSchedule }: { event: Event; onSchedule: () => void }) {
  const primaryGoal =
    event.goals.find((g) => g.status === 'focus') ??
    event.goals.find((g) => g.status === 'active') ??
    event.goals[0]
  const duration = formatDuration(event)

  return (
    <li className="group flex items-start gap-2 rounded-lg border border-transparent px-2 py-2.5 transition-colors hover:border-border hover:bg-muted/40">
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
        className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary"
      >
        <CalendarPlus className="h-4 w-4" />
      </button>
    </li>
  )
}

function BaseEventRecItem({ baseEvent, onCreate }: { baseEvent: BaseEventSummary; onCreate: () => void }) {
  return (
    <li className="group flex items-start gap-2 rounded-lg border border-transparent px-2 py-2.5 transition-colors hover:border-border hover:bg-muted/40">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">{baseEvent.title}</p>
        {baseEvent.goal && (
          <div className="mt-1.5">
            <Badge tone={goalTone(baseEvent.goal.status)} className="max-w-[160px] truncate block">
              {baseEvent.goal.title}
            </Badge>
          </div>
        )}
      </div>
      <button
        onClick={onCreate}
        title="Create event from habit"
        className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary"
      >
        <CalendarPlus className="h-4 w-4" />
      </button>
    </li>
  )
}

export function RecommendationPanel({ date, onEventClick, onBaseEventClick, mobileOpen, onMobileClose }: RecommendationPanelProps) {
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

  function renderBody() {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-8">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )
    }
    if (groups.length === 0) {
      return <p className="px-2 py-4 text-sm text-muted-foreground">Nothing to suggest right now.</p>
    }
    return groups.map((group) => (
      <div key={group.label} className="mb-4">
        <div className="flex items-center justify-between px-2 py-2">
          <div className="flex items-center gap-1.5">
            {group.label === 'Based on Your Habits' && (
              <Sparkles className="h-3 w-3 text-muted-foreground" />
            )}
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.label}
            </h2>
          </div>
          <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">
            {group.items.length}
          </span>
        </div>
        <ul className="flex flex-col gap-0.5">
          {group.items.map((rec, i) =>
            rec.type === 'event' ? (
              <EventRecItem
                key={rec.event.id}
                event={rec.event}
                onSchedule={() => onEventClick(rec.event)}
              />
            ) : (
              <BaseEventRecItem
                key={rec.baseEvent.id + i}
                baseEvent={rec.baseEvent}
                onCreate={() => onBaseEventClick(rec.baseEvent)}
              />
            )
          )}
        </ul>
      </div>
    ))
  }

  return (
    <>
      {/* Desktop sidebar */}
      <section className="hidden md:flex w-80 shrink-0 flex-col overflow-hidden border-r border-border bg-background">
        <div className="shrink-0 px-5 py-5">
          <h1 className="text-lg font-semibold text-foreground">Suggestions</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">What to add to your schedule today.</p>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-6">{renderBody()}</div>
      </section>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={onMobileClose}
          />
          <div className="relative z-10 flex w-72 shrink-0 flex-col overflow-hidden border-r border-border bg-background">
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-4">
              <span className="text-sm font-semibold text-foreground">Suggestions</span>
              <button
                onClick={onMobileClose}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-6">{renderBody()}</div>
          </div>
        </div>
      )}
    </>
  )
}
