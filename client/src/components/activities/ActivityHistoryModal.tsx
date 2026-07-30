import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { CategoryIcon } from '@/components/categories/categoryIcons'
import { ActivityTypeIcon } from '@/components/activities/ActivityTypeIcon'
import { occurrencesApi } from '@/lib/api'
import type { Activity, Occurrence, Recommendation } from '@/lib/types'

/**
 * The cadence figures the recommendation engine already computed for this activity. Passed in rather
 * than recomputed so this dialog and the suggestion that opened it can never quote different numbers;
 * null when the caller has no recommendation to hand (a floating occurrence, say), which only costs
 * the two tiles that need it.
 */
export type RecommendationStats = Pick<
  Recommendation,
  'typicalStartTime' | 'typicalDurationMinutes' | 'medianGapDays' | 'patternCount'
>

export function statsOf(rec: Recommendation): RecommendationStats {
  return {
    typicalStartTime: rec.typicalStartTime,
    typicalDurationMinutes: rec.typicalDurationMinutes,
    medianGapDays: rec.medianGapDays,
    patternCount: rec.patternCount,
  }
}

/** Rows in the strip, one per week. 8 is two months: enough to read a weekly rhythm without the grid
 *  dominating the dialog it sits in. */
const STRIP_WEEKS = 8
const RECENT_LIMIT = 10
const GOAL_TONE: Record<string, 'focus' | 'active' | 'bench' | 'neutral'> = {
  focus: 'focus', active: 'active', bench: 'bench', closed: 'neutral',
}

/**
 * An activity's track record, reachable straight from a suggestion instead of via the activities page.
 *
 * Read-only: the question it answers is "have I been doing this, and when", so the only way out is to
 * the activity itself. Everything comes from the occurrence list the activity detail page already
 * loads, on the same cache key, so opening this warms that page and the other way round.
 */
export function ActivityHistoryModal({
  open,
  activity,
  stats,
  onClose,
}: {
  open: boolean
  /** Null keeps the modal closed. */
  activity: Activity | null
  stats?: RecommendationStats | null
  onClose: () => void
}) {
  const navigate = useNavigate()

  const { data: occurrences, isLoading } = useQuery({
    queryKey: ['events', 'activity', activity?.id],
    queryFn: () => occurrencesApi.list({ activityId: activity!.id }),
    enabled: open && !!activity,
  })

  const summary = useMemo(() => summarise(occurrences ?? []), [occurrences])
  const loading = isLoading || !occurrences

  return (
    <Modal
      open={open && !!activity}
      onClose={onClose}
      title={activity ? `${activity.title} - history` : 'History'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button
            variant="outline"
            onClick={() => { onClose(); navigate(`/activities/${activity!.id}`) }}
          >
            Open activity
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" strokeWidth={2} />
          </Button>
        </>
      }
    >
      {activity && <MetaLine activity={activity} />}

      {/*
        Every section below is rendered on the first frame, loaded or not: the tiles and the strip have
        a data-independent shape, and the list is a fixed-height box that scrolls. The request lands
        while the panel is still animating in, so a shell that grows into the answer reads as a stutter.
      */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Last done" value={summary.lastDoneLabel} loading={loading} />
        <Stat label="Cadence" value={cadenceLabel(stats, summary)} loading={loading} />
        <Stat label="Usual time" value={stats?.typicalStartTime ?? null} loading={loading} />
        <Stat
          label="Usual length"
          value={durationLabel(stats?.typicalDurationMinutes ?? null)}
          loading={loading}
        />
      </div>

      <DayStrip occurrences={occurrences ?? []} loading={loading} />

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Recent
          </h3>
          {loading ? (
            <span className="h-3 w-32 animate-pulse rounded bg-border" />
          ) : (
            <span className="text-[11px] text-muted-foreground">
              {summary.done} done, {summary.skipped} skipped, {summary.pending} pending
            </span>
          )}
        </div>
        <div className="h-[11.5rem] overflow-y-auto rounded-lg border border-border">
          {loading ? (
            <RecentSkeleton />
          ) : summary.recent.length === 0 ? (
            <p className="flex h-full items-center justify-center px-3 text-center text-sm text-muted-foreground">
              Nothing recorded yet. This suggestion is the first time round.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {summary.recent.map((o) => <RecentRow key={o.id} occ={o} />)}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

/** Type, category and goal, matching the meta line an activity row shows. */
function MetaLine({ activity }: { activity: Activity }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
      {activity.type && (
        <span className="flex items-center gap-1.5">
          <ActivityTypeIcon icon={activity.type.icon} className="h-3.5 w-3.5" />
          {activity.type.name}
        </span>
      )}
      {activity.category && (
        <span className="flex items-center gap-1.5">
          <CategoryIcon icon={activity.category.icon} color={activity.category.color} size={12} strokeWidth={2} />
          {activity.category.name}
        </span>
      )}
      {activity.goal && (
        <Badge tone={GOAL_TONE[activity.goal.status] ?? 'neutral'}>{activity.goal.title}</Badge>
      )}
    </div>
  )
}

function Stat({ label, value, loading }: { label: string; value: string | null; loading?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 px-2.5 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {loading ? (
        <span className="mt-0.5 flex h-5 items-center" aria-hidden="true">
          <span className="h-3 w-12 animate-pulse rounded bg-border" />
        </span>
      ) : (
        <p className={`mt-0.5 text-sm ${value ? 'text-foreground' : 'text-muted-foreground'}`}>
          {value ?? 'Unknown'}
        </p>
      )}
    </div>
  )
}

/** Fills the recent box while the occurrences load; the box owns the height, these own the shape. */
function RecentSkeleton() {
  return (
    <div className="animate-pulse divide-y divide-border" aria-busy="true" aria-label="Loading history">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex h-9 items-center gap-3 px-3">
          <span className="h-2 w-2 shrink-0 rounded-full bg-border" />
          <span className="h-3 flex-1 rounded bg-border" />
          <span className="h-3 w-10 shrink-0 rounded bg-border" />
        </div>
      ))}
    </div>
  )
}

/**
 * One cell per day for the last eight weeks, laid out the way a calendar is: a column per weekday
 * under its name, a row per week, the current week last. A habit that only ever happens at the
 * weekend is then a vertical stripe, and one that lapsed a month ago stops partway down. This is the
 * part the activities page cannot do: a flat list makes you reconstruct the rhythm yourself.
 *
 * The grid is the same size empty as full, so it renders while loading too - only the fills wait.
 */
function DayStrip({ occurrences, loading }: { occurrences: Occurrence[]; loading?: boolean }) {
  const { weeks, weekdays } = useMemo(() => buildStrip(occurrences), [occurrences])

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className={`flex flex-col gap-1 ${loading ? 'animate-pulse' : ''}`}>
        <div className="flex gap-1">
          {weekdays.map((label) => (
            <span key={label} className="w-7 text-center text-[10px] leading-none text-muted-foreground">
              {label}
            </span>
          ))}
        </div>
        {weeks.map((week, w) => (
          <div key={w} className="flex gap-1">
            {week.map((cell, d) => (
              <span
                key={d}
                title={cell.title}
                className={`h-7 w-7 rounded-[4px] ${cellCls(cell.kind)}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-[3px] ${cellCls('done')}`} /> done</span>
        <span className="flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-[3px] ${cellCls('skipped')}`} /> skipped</span>
        <span className="flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-[3px] ${cellCls('pending')}`} /> pending</span>
        <span>last {STRIP_WEEKS} weeks</span>
      </div>
    </div>
  )
}

type CellKind = 'empty' | 'outside' | 'done' | 'skipped' | 'pending'

function cellCls(kind: CellKind): string {
  if (kind === 'done') return 'bg-primary'
  if (kind === 'skipped') return 'bg-muted-foreground/60'
  if (kind === 'pending') return 'border border-primary/50 bg-primary/10'
  if (kind === 'outside') return 'bg-transparent'
  return 'bg-muted'
}

interface Cell {
  kind: CellKind
  title: string
}

/**
 * The strip laid out as week rows of seven weekday columns, ending on the week that holds today. A
 * day with more than one occurrence takes the strongest of them: done beats skipped beats pending,
 * since the strip answers "did it happen".
 */
function buildStrip(occurrences: Occurrence[]): { weeks: Cell[][]; weekdays: string[] } {
  const byDay = new Map<string, CellKind>()
  const rank: Record<string, number> = { pending: 1, skipped: 2, done: 3 }
  for (const o of occurrences) {
    if (!o.startAt) continue
    const key = dayKey(new Date(o.startAt))
    const kind = o.status as CellKind
    const held = byDay.get(key)
    if (!held || rank[kind] > rank[held]) byDay.set(key, kind)
  }

  // Weeks start on Monday, so the column a day lands in is the one under its own name.
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const mondayOffset = (today.getDay() + 6) % 7
  const lastMonday = new Date(today)
  lastMonday.setDate(lastMonday.getDate() - mondayOffset)
  const first = new Date(lastMonday)
  first.setDate(first.getDate() - (STRIP_WEEKS - 1) * 7)

  const weeks: Cell[][] = []
  for (let w = 0; w < STRIP_WEEKS; w++) {
    const row: Cell[] = []
    for (let d = 0; d < 7; d++) {
      const day = new Date(first)
      day.setDate(day.getDate() + w * 7 + d)
      if (day > today) {
        row.push({ kind: 'outside', title: '' })
        continue
      }
      const kind = byDay.get(dayKey(day)) ?? 'empty'
      const date = day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
      row.push({ kind, title: kind === 'empty' ? date : `${date}: ${kind}` })
    }
    weeks.push(row)
  }

  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  return { weeks, weekdays }
}

function RecentRow({ occ }: { occ: Occurrence }) {
  const dotCls =
    occ.status === 'done'    ? 'bg-primary' :
    occ.status === 'skipped' ? 'bg-muted-foreground' :
                               'border border-border bg-background'
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dotCls}`} />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {occ.startAt ? formatDay(occ.startAt) : 'No date'}
        {occ.startAt && !occ.isAllDay && (
          <span className="ml-2 font-mono text-xs text-muted-foreground">{hhmm(new Date(occ.startAt))}</span>
        )}
      </span>
      <span className="shrink-0 text-[11px] capitalize text-muted-foreground">
        {occ.status === 'pending' ? (occ.isPlanned ? 'planned' : 'pending') : occ.status}
      </span>
    </div>
  )
}

interface Summary {
  done: number
  skipped: number
  pending: number
  lastDoneLabel: string | null
  /** Days between the two most recent completions; the fallback when no engine stats came in. */
  observedGapDays: number | null
  recent: Occurrence[]
}

function summarise(occurrences: Occurrence[]): Summary {
  let done = 0, skipped = 0, pending = 0
  for (const o of occurrences) {
    if (o.status === 'done') done++
    else if (o.status === 'skipped') skipped++
    else pending++
  }

  const doneDates = occurrences
    .filter((o) => o.status === 'done' && o.startAt)
    .map((o) => new Date(o.startAt!))
    .sort((a, b) => b.getTime() - a.getTime())

  const recent = occurrences
    .slice()
    .sort((a, b) => {
      if (a.startAt && b.startAt) return new Date(b.startAt).getTime() - new Date(a.startAt).getTime()
      if (a.startAt) return -1
      if (b.startAt) return 1
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })
    .slice(0, RECENT_LIMIT)

  return {
    done, skipped, pending,
    lastDoneLabel: doneDates.length > 0 ? relativeDayLabel(doneDates[0]) : null,
    observedGapDays: doneDates.length >= 2 ? daysBetween(doneDates[1], doneDates[0]) : null,
    recent,
  }
}

/**
 * The engine's median gap when the caller had a recommendation, and the gap between the last two
 * completions otherwise. Labelled differently, because one is a habit and the other is one interval.
 */
function cadenceLabel(stats: RecommendationStats | null | undefined, summary: Summary): string | null {
  if (stats?.medianGapDays != null) return `Every ${Math.max(1, Math.round(stats.medianGapDays))}d`
  if (stats?.patternCount != null) return `${stats.patternCount}x lately`
  if (summary.observedGapDays != null) return `${summary.observedGapDays}d last gap`
  return null
}

function durationLabel(mins: number | null): string | null {
  if (!mins || mins <= 0) return null
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** "Today", "Yesterday", or "12d ago" - a count, not a date: the question is how long it has been. */
function relativeDayLabel(d: Date): string {
  const days = daysBetween(d, new Date())
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

function formatDay(iso: string): string {
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/** Whole days between two instants, counted on local calendar days rather than by elapsed hours. */
function daysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime()
  return Math.round((b - a) / 86400000)
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
