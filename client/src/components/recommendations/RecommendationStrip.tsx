import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarPlus, History, Plus, Sparkles, X } from 'lucide-react'
import { occurrencesApi, recommendationsApi } from '@/lib/api'
import type { Activity, GoalStatus, Occurrence, Recommendation } from '@/lib/types'
import { toastError } from '@/store/toasts'
import { Badge } from '@/components/ui/Badge'
import { ActivityHistoryModal, statsOf, type RecommendationStats } from '@/components/activities/ActivityHistoryModal'

export interface ActivityTiming {
  durationMinutes: number | null
  startTime: string | null
}

interface RecommendationPanelProps {
  date: string
  /** The user's current day (boundary-adjusted, computed by the page) as YYYY-MM-DD. */
  today: string
  onOccurrenceClick: (o: Occurrence) => void
  onActivityClick: (a: Activity, timing: ActivityTiming) => void
  mobileOpen?: boolean
  onMobileClose?: () => void
}

// 'today' / 'tomorrow' / 'yesterday', or a short date like 'Tue, Jul 21'
function dayLabel(date: string, today: string): string {
  const parse = (s: string) => {
    const [y, m, d] = s.split('-').map(Number)
    return { utc: Date.UTC(y, m - 1, d), local: new Date(y, m - 1, d) }
  }
  const diff = Math.round((parse(date).utc - parse(today).utc) / 86400000)
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff === -1) return 'yesterday'
  return parse(date).local.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
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
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function timingLabel(duration: number | null, startTime: string | null): string | null {
  if (!startTime) return duration ? `~${formatMins(duration)}` : null
  const [h, m] = startTime.split(':').map(Number)
  const startLabel = formatTimeLabel(startTime)
  if (!duration) return startLabel
  const endTotal = h * 60 + m + duration
  const endLabel = `${String(Math.floor(endTotal / 60) % 24).padStart(2, '0')}:${String(endTotal % 60).padStart(2, '0')}`
  return `${startLabel} - ${endLabel}`
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function weekdayPlural(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return `${new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long' })}s`
}

// Why this activity is being suggested, from the raw signals on the DTO. Phrased relative to the
// target day rather than to now, since the panel can be pointed at any date. Null = no history.
function reasonText(rec: Recommendation, date: string): string | null {
  if (rec.patternCount) return `Usually on ${weekdayPlural(date)}, ${rec.patternCount}x lately`
  if (rec.daysSinceLast === null) return null
  if (rec.daysSinceLast === 0) return 'Done earlier today'
  const since = `${rec.daysSinceLast}d since last`
  if (rec.medianGapDays === null) return since
  return `${since}, usually every ${Math.max(1, Math.round(rec.medianGapDays))}d`
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

/**
 * Reaches the activity's track record without leaving the day being planned. Recedes until the row is
 * hovered, but never disappears: on touch there is no hover to reveal it with.
 */
function HistoryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="View history"
      aria-label="View history"
      className="shrink-0 text-muted-foreground opacity-50 transition-opacity hover:text-primary group-hover:opacity-100"
    >
      <History className="h-4 w-4" />
    </button>
  )
}

function OccurrenceRecItem({
  occurrence,
  onSchedule,
  onHistory,
}: {
  occurrence: Occurrence
  onSchedule: () => void
  onHistory: () => void
}) {
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
      <div className="mt-0.5 flex shrink-0 items-center gap-1.5">
        <HistoryButton onClick={onHistory} />
        <button
          onClick={onSchedule}
          title={occurrence.startAt ? 'Edit occurrence' : 'Schedule occurrence'}
          className="shrink-0 text-muted-foreground hover:text-primary"
        >
          <CalendarPlus className="h-4 w-4" />
        </button>
      </div>
    </li>
  )
}

function ActivityRecItem({
  rec,
  date,
  onCreate,
  onQuickSchedule,
  onHistory,
  isScheduling,
}: {
  rec: Recommendation
  date: string
  onCreate: () => void
  onQuickSchedule: () => void
  onHistory: () => void
  isScheduling: boolean
}) {
  const activity = rec.activity
  const reason = reasonText(rec, date)
  // With a one-click slot the pill already carries the time, so the meta shows effort only.
  // Without one, fall back to the full timing hint.
  const meta = rec.suggestedStartAt
    ? rec.typicalDurationMinutes
      ? `~${formatMins(rec.typicalDurationMinutes)}`
      : null
    : timingLabel(rec.typicalDurationMinutes, rec.typicalStartTime)

  return (
    <li className="group rounded-lg border border-transparent px-2 py-2.5 transition-colors hover:border-border hover:bg-muted/40">
      <div className="flex items-start gap-2">
        <button onClick={onCreate} className="min-w-0 flex-1 text-left" title="Schedule activity">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm text-foreground">{activity.title}</p>
            {meta && (
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{meta}</span>
            )}
          </div>
          {reason && (
            <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground/80">{reason}</p>
          )}
          {activity.goal && (
            <div className="mt-1.5">
              <Badge tone={goalTone(activity.goal.status)} className="max-w-[160px] truncate block">
                {activity.goal.title}
              </Badge>
            </div>
          )}
        </button>
        {/* h-5 is the title line's height: the group centres on it whether it holds bare icons or the
            taller bordered pill, so the duration/time meta never floats above the controls. */}
        <div className="flex h-5 shrink-0 items-center gap-1.5">
          <HistoryButton onClick={onHistory} />
          {rec.suggestedStartAt ? (
            <button
              onClick={onQuickSchedule}
              disabled={isScheduling}
              title={`Schedule at ${formatClock(rec.suggestedStartAt)}`}
              className="flex h-5 shrink-0 items-center gap-0.5 rounded-md border border-border pl-1 pr-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary disabled:opacity-50"
            >
              <Plus className="h-3 w-3" strokeWidth={2.5} />
              {formatClock(rec.suggestedStartAt)}
            </button>
          ) : (
            <button
              onClick={onCreate}
              title="Schedule activity"
              className="shrink-0 text-muted-foreground hover:text-primary"
            >
              <CalendarPlus className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

export function RecommendationPanel({ date, today, onOccurrenceClick, onActivityClick, mobileOpen, onMobileClose }: RecommendationPanelProps) {
  const qc = useQueryClient()
  const label = dayLabel(date, today)
  const isNamedDay = label === 'today' || label === 'tomorrow' || label === 'yesterday'

  // Owned here rather than lifted to a prop: every page that renders the panel wants the same dialog,
  // and none of them has anything to add to it.
  const [history, setHistory] = useState<{ activity: Activity; stats: RecommendationStats | null } | null>(null)

  // One-click scheduling into the server-picked slot. The modal path stays available on the
  // row body for anything that needs adjusting.
  const scheduleMutation = useMutation({
    mutationFn: (rec: Recommendation) => {
      const startAt = rec.suggestedStartAt!
      const endAt = rec.typicalDurationMinutes
        ? new Date(new Date(startAt).getTime() + rec.typicalDurationMinutes * 60000).toISOString()
        : null
      return occurrencesApi.create({ activityId: rec.activity.id, startAt, endAt })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
    },
    onError: (err) => toastError(err, 'Could not schedule that.'),
  })

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

  // Planned floating occurrences; unplanned floating ones live in the Daily Plan's
  // Floating group instead.
  const floatingOnly = useMemo(
    () => allFloating.filter((o) => o.isPlanned),
    [allFloating],
  )

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
        {/* Floating first: these are already committed to, they only need a time. */}
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
                  onHistory={() => setHistory({ activity: o.activity, stats: null })}
                />
              ))}
            </ul>
          </div>
        )}
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
              {group.items.map((rec, i) => (
                <ActivityRecItem
                  key={rec.activity.id + i}
                  rec={rec}
                  date={date}
                  onCreate={() => onActivityClick(rec.activity, { durationMinutes: rec.typicalDurationMinutes, startTime: rec.typicalStartTime })}
                  onQuickSchedule={() => scheduleMutation.mutate(rec)}
                  onHistory={() => setHistory({ activity: rec.activity, stats: statsOf(rec) })}
                  isScheduling={
                    scheduleMutation.isPending &&
                    scheduleMutation.variables?.activity.id === rec.activity.id
                  }
                />
              ))}
            </ul>
          </div>
        ))}
      </>
    )
  }

  return (
    <>
      {/* Desktop sidebar */}
      <section className="hidden md:flex w-80 shrink-0 flex-col overflow-hidden border-r border-border bg-background">
        <div className="shrink-0 px-5 py-5">
          <h1 className="text-lg font-semibold text-foreground">Suggestions</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            What to add to your schedule {isNamedDay ? label : `on ${label}`}.
          </p>
        </div>
        <div className="scroll-slim flex-1 overflow-y-auto px-3 pb-6">{renderBody()}</div>
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
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-foreground">Suggestions</span>
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
              <button
                onClick={onMobileClose}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
            <div className="scroll-slim flex-1 overflow-y-auto px-3 pb-6">{renderBody()}</div>
          </div>
        </div>
      )}

      <ActivityHistoryModal
        open={history !== null}
        activity={history?.activity ?? null}
        stats={history?.stats}
        onClose={() => setHistory(null)}
      />
    </>
  )
}
