import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarPlus, Sparkles, X } from 'lucide-react'
import { occurrencesApi, recommendationsApi } from '@/lib/api'
import type { Activity, GoalStatus, Occurrence, Recommendation } from '@/lib/types'
import { Badge } from '@/components/ui/Badge'

export interface ActivityTiming {
  durationMinutes: number | null
  startTime: string | null
}

interface RecommendationPanelProps {
  date: string
  onOccurrenceClick: (o: Occurrence) => void
  onActivityClick: (a: Activity, timing: ActivityTiming) => void
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

function formatMins(mins: number): string {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function formatTimeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const ampm = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 || 12
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`
}

function timingLabel(duration: number | null, startTime: string | null): string | null {
  const parts: string[] = []
  if (duration) parts.push(`~${formatMins(duration)}`)
  if (startTime) parts.push(formatTimeLabel(startTime))
  return parts.length > 0 ? parts.join(' · ') : null
}

function formatDuration(o: Occurrence): string | null {
  let mins: number
  if (o.startAt && o.endAt) {
    mins = Math.round((new Date(o.endAt).getTime() - new Date(o.startAt).getTime()) / 60000)
  } else if (o.durationMinutes) {
    mins = o.durationMinutes
  } else {
    return null
  }
  if (mins <= 0) return null
  return formatMins(mins)
}

function OccurrenceRecItem({ occurrence, onSchedule }: { occurrence: Occurrence; onSchedule: () => void }) {
  const goal = occurrence.activity.goal
  const duration = formatDuration(occurrence)

  return (
    <li className="group flex items-start gap-2 rounded-lg border border-transparent px-2 py-2.5 transition-colors hover:border-border hover:bg-muted/40">
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm text-foreground">{occurrence.effectiveTitle}</p>
          {duration && (
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{duration}</span>
          )}
        </div>
        {goal && (
          <div className="mt-1.5">
            <Badge tone={goalTone(goal.status)} className="max-w-[160px] truncate block">
              {goal.title}
            </Badge>
          </div>
        )}
      </div>
      <button
        onClick={onSchedule}
        title={occurrence.startAt ? 'Edit occurrence' : 'Schedule occurrence'}
        className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary"
      >
        <CalendarPlus className="h-4 w-4" />
      </button>
    </li>
  )
}

function ActivityRecItem({
  activity,
  timing,
  onCreate,
}: {
  activity: Activity
  timing: ActivityTiming
  onCreate: () => void
}) {
  const hint = timingLabel(timing.durationMinutes, timing.startTime)

  return (
    <li className="group flex items-start gap-2 rounded-lg border border-transparent px-2 py-2.5 transition-colors hover:border-border hover:bg-muted/40">
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm text-foreground">{activity.title}</p>
          {hint && (
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{hint}</span>
          )}
        </div>
        {activity.goal && (
          <div className="mt-1.5">
            <Badge tone={goalTone(activity.goal.status)} className="max-w-[160px] truncate block">
              {activity.goal.title}
            </Badge>
          </div>
        )}
      </div>
      <button
        onClick={onCreate}
        title="Schedule activity"
        className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary"
      >
        <CalendarPlus className="h-4 w-4" />
      </button>
    </li>
  )
}

export function RecommendationPanel({ date, onOccurrenceClick, onActivityClick, mobileOpen, onMobileClose }: RecommendationPanelProps) {
  const { data: recommendations = [], isLoading } = useQuery({
    queryKey: ['recommendations', date],
    queryFn: () => recommendationsApi.list(date),
    staleTime: 30 * 1000,
  })

  const { data: allFloating = [], isLoading: isLoadingFloating } = useQuery({
    queryKey: ['events', 'floating'],
    queryFn: () => occurrencesApi.list({ floating: true, status: 'pending' }),
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

  // Floating occurrences not already in the recs list (recs are now all activities, so all floating show here)
  const floatingOnly = useMemo(() => {
    const recIds = new Set(
      recommendations.flatMap((r) => (r.type === 'occurrence' ? [r.occurrence.id] : [])),
    )
    return allFloating.filter((o) => !recIds.has(o.id))
  }, [allFloating, recommendations])

  function renderBody() {
    if (isLoading || isLoadingFloating) {
      return (
        <div className="flex items-center justify-center py-8">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )
    }

    const hasRecs = groups.length > 0
    const hasFloating = floatingOnly.length > 0

    if (!hasRecs && !hasFloating) {
      return <p className="px-2 py-4 text-sm text-muted-foreground">Nothing to suggest right now.</p>
    }

    return (
      <>
        {hasRecs && groups.map((group) => (
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
                rec.type === 'occurrence' ? (
                  <OccurrenceRecItem
                    key={rec.occurrence.id}
                    occurrence={rec.occurrence}
                    onSchedule={() => onOccurrenceClick(rec.occurrence)}
                  />
                ) : (
                  <ActivityRecItem
                    key={rec.activity.id + i}
                    activity={rec.activity}
                    timing={{ durationMinutes: rec.typicalDurationMinutes, startTime: rec.typicalStartTime }}
                    onCreate={() => onActivityClick(rec.activity, { durationMinutes: rec.typicalDurationMinutes, startTime: rec.typicalStartTime })}
                  />
                )
              )}
            </ul>
          </div>
        ))}
        {hasFloating && (
          <div className="mb-4">
            <div className="flex items-center justify-between px-2 py-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Floating
              </h2>
              <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">
                {floatingOnly.length}
              </span>
            </div>
            <ul className="flex flex-col gap-0.5">
              {floatingOnly.map((o) => (
                <OccurrenceRecItem
                  key={o.id}
                  occurrence={o}
                  onSchedule={() => onOccurrenceClick(o)}
                />
              ))}
            </ul>
          </div>
        )}
      </>
    )
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
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-modal-overlay"
            onClick={onMobileClose}
          />
          <div className="relative z-10 flex w-72 shrink-0 flex-col overflow-hidden border-r border-border bg-background animate-modal-panel-left">
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
