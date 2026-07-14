import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { marked } from 'marked'
import { ArrowLeft, Plus, Pencil, Trash2, Check } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { goalsApi, checkpointsApi, activitiesApi, occurrencesApi, ApiError } from '@/lib/api'
import type { Goal, GoalStatus, Checkpoint, CheckpointSize, Activity, Occurrence } from '@/lib/types'
import { GoalModal } from '@/components/goals/GoalModal'
import { CheckpointModal } from '@/components/goals/CheckpointModal'

// ── helpers ──────────────────────────────────────────────────────────────────

type Tier = 'focus' | 'active' | 'bench'

const TIER_META: Record<Tier, { label: string; dot: string; badge: 'focus' | 'active' | 'bench' }> = {
  focus:  { label: 'Focus',  dot: 'bg-goal-focus',  badge: 'focus' },
  active: { label: 'Active', dot: 'bg-goal-active', badge: 'active' },
  bench:  { label: 'Bench',  dot: 'bg-goal-bench',  badge: 'bench' },
}

const BAR_COLORS: Record<Tier, string> = {
  focus:  'bg-goal-focus',
  active: 'bg-goal-active',
  bench:  'bg-goal-bench',
}

const SIZE_WEIGHT: Record<CheckpointSize, number> = {
  tiny: 1, small: 2, normal: 3, big: 5, huge: 8,
}

const STATUS_TRANSITIONS: Record<GoalStatus, { label: string; value: GoalStatus }[]> = {
  focus:  [{ label: 'Move to Active', value: 'active' }, { label: 'Move to Bench', value: 'bench' }, { label: 'Close', value: 'closed' }],
  active: [{ label: 'Move to Focus',  value: 'focus'  }, { label: 'Move to Bench', value: 'bench' }, { label: 'Close', value: 'closed' }],
  bench:  [{ label: 'Move to Active', value: 'active' }, { label: 'Move to Focus', value: 'focus'  }, { label: 'Close', value: 'closed' }],
  closed: [{ label: 'Reopen',         value: 'active' }],
}

function believedProgress(checkpoints: Checkpoint[]): number {
  const total = checkpoints.reduce((sum, c) => sum + SIZE_WEIGHT[c.size], 0)
  if (total === 0) return 0
  const reached = checkpoints
    .filter((c) => c.status === 'reached')
    .reduce((sum, c) => sum + SIZE_WEIGHT[c.size], 0)
  return (reached / total) * 100
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

// ── sub-components ───────────────────────────────────────────────────────────

function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">{count}</span>
    </div>
  )
}

function CheckpointRow({
  checkpoint, goalId, isLast, onEdit,
}: {
  checkpoint: Checkpoint; goalId: string; isLast: boolean; onEdit: (cp: Checkpoint) => void
}) {
  const qc = useQueryClient()
  const reached = checkpoint.status === 'reached'

  const toggleMutation = useMutation({
    mutationFn: () => checkpointsApi.setStatus(goalId, checkpoint.id, reached ? 'pending' : 'reached'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: () => checkpointsApi.delete(goalId, checkpoint.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })

  return (
    <li className="group flex gap-3">
      <div className="flex flex-col items-center">
        <button
          onClick={() => toggleMutation.mutate()}
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
            reached
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background hover:border-primary'
          }`}
        >
          {reached && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
        </button>
        {!isLast && <span className="my-0.5 w-px flex-1 bg-border" />}
      </div>
      <div className={`flex min-w-0 flex-1 items-start justify-between gap-2 ${isLast ? '' : 'pb-3'}`}>
        <div className="flex min-w-0 flex-col">
          <span className={`text-sm ${reached ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
            {checkpoint.title}
          </span>
          <span className="text-[11px] text-muted-foreground capitalize">{checkpoint.size}</span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onEdit(checkpoint)}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Pencil className="h-3 w-3" strokeWidth={2} />
          </button>
          <button
            onClick={() => deleteMutation.mutate()}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" strokeWidth={2} />
          </button>
        </div>
      </div>
    </li>
  )
}

function ActivityRow({ activity }: { activity: Activity }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      {activity.category && (
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: activity.category.color }} />
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
  const status = occ.status
  const dotCls =
    status === 'done'    ? 'bg-primary' :
    status === 'skipped' ? 'bg-muted-foreground' :
                           'border border-border bg-background'
  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dotCls}`} />
      <div className="min-w-0 flex-1">
        <span className={`text-sm ${status === 'done' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
          {occ.effectiveTitle}
        </span>
        {occ.startAt && (
          <p className="text-[11px] text-muted-foreground">
            {formatDate(occ.startAt)}
            {!occ.isAllDay && ` · ${formatTime(occ.startAt)}`}
          </p>
        )}
      </div>
      <span className="shrink-0 text-[11px] capitalize text-muted-foreground">
        {status === 'pending' ? (occ.isPlanned ? 'planned' : 'pending') : status}
      </span>
    </li>
  )
}

function Spinner() {
  return (
    <div className="flex justify-center py-8">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  )
}

// ── page ─────────────────────────────────────────────────────────────────────

export function GoalDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [editModal, setEditModal] = useState(false)
  const [cpModal, setCpModal] = useState<{ open: boolean; checkpoint?: Checkpoint }>({ open: false })
  const [statusError, setStatusError] = useState('')
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesValue, setNotesValue] = useState('')

  const { data: goal, isLoading } = useQuery({
    queryKey: ['goals', id],
    queryFn: () => goalsApi.get(id!),
    enabled: !!id,
    initialData: () => qc.getQueryData<Goal[]>(['goals'])?.find(g => g.id === id),
    initialDataUpdatedAt: () => qc.getQueryState(['goals'])?.dataUpdatedAt,
  })

  const { data: activities = [], isLoading: loadingActivities } = useQuery({
    queryKey: ['activities', { goalId: id }],
    queryFn: () => activitiesApi.list({ goalId: id! }),
    enabled: !!id,
  })

  const { data: occurrences = [], isLoading: loadingOccurrences } = useQuery({
    queryKey: ['events', 'goal', id],
    queryFn: () => occurrencesApi.list({ goalId: id! }),
    enabled: !!id,
  })

  const notesMutation = useMutation({
    mutationFn: (notes: string | null) =>
      goalsApi.update(id!, { title: goal!.title, description: goal!.description, kind: goal!.kind, notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goals'] })
      setEditingNotes(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => goalsApi.delete(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goals'] })
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
      navigate('/goals')
    },
  })

  const statusMutation = useMutation({
    mutationFn: (status: GoalStatus) => goalsApi.setStatus(id!, status),
    onSuccess: () => {
      setStatusError('')
      qc.invalidateQueries({ queryKey: ['goals'] })
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
    },
    onError: (err) => {
      setStatusError(err instanceof ApiError ? err.message : 'Something went wrong.')
    },
  })

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <PageHeader
          title="Goal"
          leading={
            <button onClick={() => navigate('/goals')} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
              <ArrowLeft className="h-4 w-4" strokeWidth={2} />
            </button>
          }
        />
        <Spinner />
      </div>
    )
  }

  if (!goal) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <PageHeader
          title="Goal not found"
          leading={
            <button onClick={() => navigate('/goals')} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
              <ArrowLeft className="h-4 w-4" strokeWidth={2} />
            </button>
          }
        />
        <p className="px-6 py-8 text-sm text-muted-foreground">This goal could not be found.</p>
      </div>
    )
  }

  const tier = (goal.status === 'closed' ? 'bench' : goal.status) as Tier
  const isMilestone = goal.kind === 'milestone'
  const believed = believedProgress(goal.checkpoints)
  const transitions = STATUS_TRANSITIONS[goal.status]
  const hasCheckpoints = goal.checkpoints.length > 0

  const sortedOccurrences = occurrences
    .slice()
    .sort((a, b) => {
      if (a.startAt && b.startAt) return new Date(b.startAt).getTime() - new Date(a.startAt).getTime()
      if (a.startAt) return -1
      if (b.startAt) return 1
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        leading={
          <button
            onClick={() => navigate('/goals')}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={2} />
          </button>
        }
        title={goal.title}
        action={
          <div className="flex items-center gap-1">
            <button
              onClick={() => setEditModal(true)}
              className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
              Edit
            </button>
            <button
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-destructive transition-colors disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6">
        <div className="mx-auto max-w-2xl flex flex-col gap-8">

          {/* Meta */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {goal.status !== 'closed' ? (
                <Badge tone={TIER_META[tier].badge}>{TIER_META[tier].label}</Badge>
              ) : (
                <Badge tone="neutral">Closed</Badge>
              )}
              <span className="text-xs capitalize text-muted-foreground">{goal.kind}</span>
            </div>

            {goal.description && (
              <p className="text-sm text-muted-foreground">{goal.description}</p>
            )}

            {/* Progress bar (milestone only) */}
            {isMilestone && hasCheckpoints && (
              <div className="flex items-center gap-3">
                <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`absolute inset-y-0 left-0 rounded-full transition-all ${BAR_COLORS[tier]}`}
                    style={{ width: `${Math.min(believed, 100)}%` }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right font-mono text-xs text-muted-foreground">
                  {Math.round(believed)}%
                </span>
              </div>
            )}

            {/* Status transitions */}
            {transitions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {transitions.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => statusMutation.mutate(t.value)}
                    disabled={statusMutation.isPending}
                    className="h-7 rounded-md border border-border px-2.5 text-xs text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
            {statusError && <p className="text-xs text-destructive">{statusError}</p>}
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</span>
              {!editingNotes && (
                <button
                  onClick={() => { setNotesValue(goal.notes ?? ''); setEditingNotes(true) }}
                  className="-my-1 -mr-1 py-1 px-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {goal.notes ? 'Edit' : 'Add'}
                </button>
              )}
            </div>
            {editingNotes ? (
              <div className="flex flex-col gap-2">
                <textarea
                  value={notesValue}
                  onChange={(e) => setNotesValue(e.target.value)}
                  rows={8}
                  autoFocus
                  placeholder="Write notes in Markdown..."
                  className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setEditingNotes(false)}
                    disabled={notesMutation.isPending}
                    className="h-7 rounded-md border border-border px-2.5 text-xs text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => notesMutation.mutate(notesValue.trim() || null)}
                    disabled={notesMutation.isPending}
                    className="h-7 rounded-md bg-primary px-2.5 text-xs text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : goal.notes ? (
              <div
                className="notes-content text-sm text-foreground"
                dangerouslySetInnerHTML={{ __html: marked.parse(goal.notes) as string }}
              />
            ) : (
              <button
                onClick={() => { setNotesValue(''); setEditingNotes(true) }}
                className="py-1 text-left text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Add notes...
              </button>
            )}
          </div>

          {/* Checkpoints */}
          <div className="flex flex-col gap-3">
            <SectionHeading label="Checkpoints" count={goal.checkpoints.length} />
            {hasCheckpoints ? (
              <div className="rounded-lg border border-border px-3 py-3">
                <ul className="flex flex-col">
                  {goal.checkpoints.map((cp, i) => (
                    <CheckpointRow
                      key={cp.id}
                      checkpoint={cp}
                      goalId={goal.id}
                      isLast={i === goal.checkpoints.length - 1}
                      onEdit={(cp) => setCpModal({ open: true, checkpoint: cp })}
                    />
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No checkpoints yet.</p>
            )}
            <button
              onClick={() => setCpModal({ open: true })}
              className="flex w-fit items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary transition-colors"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
              Add checkpoint
            </button>
          </div>

          {/* Activities */}
          <div className="flex flex-col gap-3">
            <SectionHeading label="Activities" count={activities.length} />
            {loadingActivities ? (
              <Spinner />
            ) : activities.length === 0 ? (
              <p className="text-xs text-muted-foreground">No activities linked to this goal.</p>
            ) : (
              <div className="rounded-lg border border-border">
                <ul className="divide-y divide-border">
                  {activities.map((a) => <ActivityRow key={a.id} activity={a} />)}
                </ul>
              </div>
            )}
          </div>

          {/* Occurrences */}
          <div className="flex flex-col gap-3">
            <SectionHeading label="Occurrences" count={occurrences.length} />
            {loadingOccurrences ? (
              <Spinner />
            ) : sortedOccurrences.length === 0 ? (
              <p className="text-xs text-muted-foreground">No occurrences linked to this goal.</p>
            ) : (
              <div className="rounded-lg border border-border">
                <ul className="divide-y divide-border">
                  {sortedOccurrences.map((o) => <OccurrenceRow key={o.id} occ={o} />)}
                </ul>
              </div>
            )}
          </div>

        </div>
      </div>

      <GoalModal
        open={editModal}
        onClose={() => {
          setEditModal(false)
          qc.invalidateQueries({ queryKey: ['goals', id] })
        }}
        goal={goal}
      />
      <CheckpointModal
        open={cpModal.open}
        onClose={() => setCpModal({ open: false })}
        goalId={goal.id}
        checkpoint={cpModal.checkpoint}
      />
    </div>
  )
}
