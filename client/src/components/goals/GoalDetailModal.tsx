import { useQuery } from '@tanstack/react-query'
import { activitiesApi, occurrencesApi } from '@/lib/api'
import type { Goal, Activity, Occurrence } from '@/lib/types'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'

// ── helpers ─────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, 'focus' | 'active' | 'bench' | 'neutral'> = {
  focus: 'focus', active: 'active', bench: 'bench', closed: 'neutral',
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function OccurrenceStatusDot({ status }: { status: string }) {
  const cls =
    status === 'done'    ? 'bg-primary' :
    status === 'skipped' ? 'bg-muted-foreground' :
                           'border border-border bg-background'
  return <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${cls}`} />
}

// ── sub-rows ─────────────────────────────────────────────────────────────────

function ActivityRow({ activity }: { activity: Activity }) {
  return (
    <li className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50 transition-colors">
      {activity.category && (
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: activity.category.color }}
        />
      )}
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{activity.title}</span>
      {activity.category && (
        <span className="shrink-0 text-xs text-muted-foreground">{activity.category.name}</span>
      )}
      <span className="shrink-0 text-[11px] capitalize text-muted-foreground">{activity.kind}</span>
    </li>
  )
}

function OccurrenceRow({ occ }: { occ: Occurrence }) {
  const hasDate = occ.startAt !== null
  return (
    <li className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50 transition-colors">
      <OccurrenceStatusDot status={occ.status} />
      <div className="min-w-0 flex-1">
        <span className={`text-sm ${occ.status === 'done' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
          {occ.effectiveTitle}
        </span>
        {hasDate && (
          <p className="text-[11px] text-muted-foreground">
            {formatDate(occ.startAt)}
            {!occ.isAllDay && occ.startAt && ` · ${formatTime(occ.startAt)}`}
          </p>
        )}
      </div>
      <span className="shrink-0 text-[11px] capitalize text-muted-foreground">
        {occ.status === 'pending' ? (occ.isPlanned ? 'planned' : 'pending') : occ.status}
      </span>
    </li>
  )
}

// ── section ───────────────────────────────────────────────────────────────────

function Section({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">{count}</span>
      </div>
      {children}
    </div>
  )
}

// ── modal ─────────────────────────────────────────────────────────────────────

interface GoalDetailModalProps {
  goal: Goal | null
  open: boolean
  onClose: () => void
}

export function GoalDetailModal({ goal, open, onClose }: GoalDetailModalProps) {
  const { data: activities = [], isLoading: loadingActivities } = useQuery({
    queryKey: ['activities', { goalId: goal?.id }],
    queryFn: () => activitiesApi.list({ goalId: goal!.id }),
    enabled: open && goal !== null,
  })

  const { data: occurrences = [], isLoading: loadingOccurrences } = useQuery({
    queryKey: ['events', 'goal', goal?.id],
    queryFn: () => occurrencesApi.list({ goalId: goal!.id }),
    enabled: open && goal !== null,
  })

  if (!goal) return null

  const badgeTone = STATUS_BADGE[goal.status] ?? 'neutral'
  const statusLabel = goal.status.charAt(0).toUpperCase() + goal.status.slice(1)

  return (
    <Modal open={open} onClose={onClose} title={goal.title}>
      {/* Meta row */}
      <div className="flex items-center gap-2">
        <Badge tone={badgeTone}>{statusLabel}</Badge>
        <span className="text-xs capitalize text-muted-foreground">{goal.kind}</span>
      </div>

      {goal.description && (
        <p className="text-sm text-muted-foreground">{goal.description}</p>
      )}

      {/* Activities */}
      <Section label="Activities" count={activities.length}>
        {loadingActivities ? (
          <div className="flex justify-center py-4">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : activities.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">No activities linked to this goal.</p>
        ) : (
          <ul className="flex flex-col overflow-y-auto max-h-48">
            {activities.map((a) => <ActivityRow key={a.id} activity={a} />)}
          </ul>
        )}
      </Section>

      {/* Occurrences */}
      <Section label="Occurrences" count={occurrences.length}>
        {loadingOccurrences ? (
          <div className="flex justify-center py-4">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : occurrences.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">No occurrences linked to this goal.</p>
        ) : (
          <ul className="flex flex-col overflow-y-auto max-h-64">
            {occurrences
              .slice()
              .sort((a, b) => {
                if (a.startAt && b.startAt) return new Date(b.startAt).getTime() - new Date(a.startAt).getTime()
                if (a.startAt) return -1
                if (b.startAt) return 1
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
              })
              .map((o) => <OccurrenceRow key={o.id} occ={o} />)}
          </ul>
        )}
      </Section>
    </Modal>
  )
}
