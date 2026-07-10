import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Check, MoreHorizontal, ChevronRight } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { goalsApi, checkpointsApi, ApiError } from '@/lib/api'
import type { Goal, GoalStatus, Checkpoint, CheckpointSize } from '@/lib/types'
import { Badge } from '@/components/ui/Badge'
import { GoalModal } from '@/components/goals/GoalModal'
import { CheckpointModal } from '@/components/goals/CheckpointModal'
import { CategoryIcon } from '@/components/categories/categoryIcons'

// ── helpers ────────────────────────────────────────────────────────────────

const STATUS_ORDER: GoalStatus[] = ['focus', 'active', 'bench', 'closed']

type Tier = 'focus' | 'active' | 'bench'
const TIER_META: Record<Tier, { label: string; dot: string; badge: 'focus' | 'active' | 'bench' }> = {
  focus:  { label: 'Focus',  dot: 'bg-goal-focus',  badge: 'focus' },
  active: { label: 'Active', dot: 'bg-goal-active',  badge: 'active' },
  bench:  { label: 'Bench',  dot: 'bg-goal-bench',   badge: 'bench' },
}

const BAR_COLORS: Record<Tier, string> = {
  focus:  'bg-goal-focus',
  active: 'bg-goal-active',
  bench:  'bg-goal-bench',
}

const SIZE_WEIGHT: Record<CheckpointSize, number> = {
  tiny: 1, small: 2, normal: 3, big: 5, huge: 8,
}

function believedProgress(checkpoints: Checkpoint[]): number {
  const total = checkpoints.reduce((sum, c) => sum + SIZE_WEIGHT[c.size], 0)
  if (total === 0) return 0
  const reached = checkpoints
    .filter((c) => c.status === 'reached')
    .reduce((sum, c) => sum + SIZE_WEIGHT[c.size], 0)
  return (reached / total) * 100
}

const STATUS_TRANSITIONS: Record<GoalStatus, { label: string; value: GoalStatus }[]> = {
  focus:  [{ label: 'Move to Active', value: 'active' }, { label: 'Move to Bench', value: 'bench' }, { label: 'Close', value: 'closed' }],
  active: [{ label: 'Move to Focus',  value: 'focus' },  { label: 'Move to Bench', value: 'bench' }, { label: 'Close', value: 'closed' }],
  bench:  [{ label: 'Move to Active', value: 'active' }, { label: 'Move to Focus', value: 'focus' }, { label: 'Close', value: 'closed' }],
  closed: [{ label: 'Reopen',         value: 'active' }],
}

// ── sub-components ─────────────────────────────────────────────────────────

interface CheckpointRowProps {
  checkpoint: Checkpoint
  goalId: string
  isLast: boolean
  onEdit: (cp: Checkpoint) => void
}

function CheckpointRow({ checkpoint, goalId, isLast, onEdit }: CheckpointRowProps) {
  const qc = useQueryClient()
  const reached = checkpoint.status === 'reached'

  const toggleMutation = useMutation({
    mutationFn: () =>
      checkpointsApi.setStatus(goalId, checkpoint.id, reached ? 'pending' : 'reached'),
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
        <span className={`text-sm ${reached ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
          {checkpoint.title}
          {checkpoint.size !== 'normal' && (
            <span className="ml-1.5 text-[11px] text-muted-foreground capitalize">{checkpoint.size}</span>
          )}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
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

function GoalMenu({
  transitions,
  isPending,
  onEdit,
  onDelete,
  onStatusSelect,
  onAddCheckpoint,
}: {
  transitions: { label: string; value: GoalStatus }[]
  isPending: boolean
  onEdit: () => void
  onDelete: () => void
  onStatusSelect: (value: GoalStatus) => void
  onAddCheckpoint: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={isPending}
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
      >
        <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-border bg-card py-1 shadow-pop">
          <button
            onClick={() => { onEdit(); setOpen(false) }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted transition-colors"
          >
            <Pencil className="h-3 w-3" strokeWidth={2} />
            Edit goal
          </button>
          <button
            onClick={() => { onAddCheckpoint(); setOpen(false) }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted transition-colors"
          >
            <Plus className="h-3 w-3" strokeWidth={2} />
            Add checkpoint
          </button>
          {transitions.length > 0 && <div className="my-1 border-t border-border" />}
          {transitions.map((t) => (
            <button
              key={t.value}
              onClick={() => { onStatusSelect(t.value); setOpen(false) }}
              className="w-full px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted transition-colors"
            >
              {t.label}
            </button>
          ))}
          <div className="my-1 border-t border-border" />
          <button
            onClick={() => { onDelete(); setOpen(false) }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-destructive hover:bg-muted transition-colors"
          >
            <Trash2 className="h-3 w-3" strokeWidth={2} />
            Delete goal
          </button>
        </div>
      )}
    </div>
  )
}

interface GoalRowProps {
  goal: Goal
  onEdit: (g: Goal) => void
  onAddCheckpoint: (goalId: string) => void
  onEditCheckpoint: (goalId: string, cp: Checkpoint) => void
}

function GoalRow({ goal, onEdit, onAddCheckpoint, onEditCheckpoint }: GoalRowProps) {
  const qc = useQueryClient()
  const [statusError, setStatusError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const tier = (goal.status === 'closed' ? 'bench' : goal.status) as Tier
  const believed = believedProgress(goal.checkpoints)
  const transitions = STATUS_TRANSITIONS[goal.status]
  const hasCheckpoints = goal.checkpoints.length > 0

  const deleteMutation = useMutation({
    mutationFn: () => goalsApi.delete(goal.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goals'] })
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
    },
  })

  const statusMutation = useMutation({
    mutationFn: (status: GoalStatus) => goalsApi.setStatus(goal.id, status),
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

  return (
    <li className="flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2.5 transition-colors hover:bg-muted/40">
        {/* Expand chevron (when checkpoints exist) or category icon */}
        {hasCheckpoints ? (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight
              className={`h-3 w-3 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
              strokeWidth={2.5}
            />
          </button>
        ) : goal.category ? (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
            <CategoryIcon icon={goal.category.icon} color={goal.category.color} size={13} strokeWidth={2} />
          </span>
        ) : (
          <span className="h-4 w-4 shrink-0" />
        )}

        {/* Title + description */}
        <div className="min-w-0 flex-1">
          <span className="text-sm text-foreground">{goal.title}</span>
          {goal.description && (
            <p className="truncate text-xs text-muted-foreground">{goal.description}</p>
          )}
        </div>

        {/* Compact inline progress */}
        {goal.status !== 'closed' && hasCheckpoints && (
          <div className="flex w-20 shrink-0 items-center gap-1.5">
            <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={`absolute inset-y-0 left-0 rounded-full ${BAR_COLORS[tier]} transition-all`}
                style={{ width: `${Math.min(believed, 100)}%` }}
              />
            </div>
            <span className="w-7 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
              {Math.round(believed)}%
            </span>
          </div>
        )}

        {/* Status badge */}
        {goal.status !== 'closed' ? (
          <Badge tone={TIER_META[tier].badge}>{TIER_META[tier].label}</Badge>
        ) : (
          <Badge tone="neutral">Closed</Badge>
        )}

        <GoalMenu
          transitions={transitions}
          isPending={statusMutation.isPending}
          onEdit={() => onEdit(goal)}
          onDelete={() => deleteMutation.mutate()}
          onStatusSelect={(s) => statusMutation.mutate(s)}
          onAddCheckpoint={() => onAddCheckpoint(goal.id)}
        />
      </div>

      {/* Expanded checkpoint list */}
      {expanded && hasCheckpoints && (
        <div className="border-t border-border px-3 pb-3 pt-3">
          <ul className="flex flex-col">
            {goal.checkpoints.map((cp, i) => (
              <CheckpointRow
                key={cp.id}
                checkpoint={cp}
                goalId={goal.id}
                isLast={i === goal.checkpoints.length - 1}
                onEdit={(cp) => onEditCheckpoint(goal.id, cp)}
              />
            ))}
          </ul>
          <button
            onClick={() => onAddCheckpoint(goal.id)}
            className="mt-2 flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-primary transition-colors"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            Add checkpoint
          </button>
        </div>
      )}

      {statusError && <p className="px-3 pb-2 text-xs text-destructive">{statusError}</p>}
    </li>
  )
}

// ── page ───────────────────────────────────────────────────────────────────

export function GoalsPage() {
  const [goalModal, setGoalModal] = useState<{ open: boolean; goal?: Goal }>({ open: false })
  const [cpModal, setCpModal] = useState<{ open: boolean; goalId: string; checkpoint?: Checkpoint }>({
    open: false, goalId: '',
  })

  const { data: goals = [], isLoading } = useQuery({
    queryKey: ['goals'],
    queryFn: () => goalsApi.list(),
  })

  const grouped = STATUS_ORDER.reduce<Record<GoalStatus, Goal[]>>(
    (acc, s) => { acc[s] = goals.filter((g) => g.status === s); return acc },
    { focus: [], active: [], bench: [], closed: [] },
  )

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Goals"
        action={
          <button
            onClick={() => setGoalModal({ open: true })}
            className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted transition-colors"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            New Goal
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <div className="mx-auto max-w-2xl">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : goals.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" />
                  <path d="M12 3v2M12 19v2M3 12h2M19 12h2" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">No goals yet</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Create your first goal to start tracking progress.</p>
              </div>
              <button
                onClick={() => setGoalModal({ open: true })}
                className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted transition-colors"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                New Goal
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {(['focus', 'active', 'bench', 'closed'] as GoalStatus[]).map((status) => {
                const list = grouped[status]
                if (list.length === 0) return null
                const tier = (status === 'closed' ? 'bench' : status) as Tier
                return (
                  <section key={status}>
                    <div className="mb-2 flex items-center gap-2 px-1">
                      {status !== 'closed' && <span className={`h-1.5 w-1.5 rounded-full ${TIER_META[tier].dot}`} />}
                      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {status === 'closed' ? 'Closed' : `${TIER_META[tier].label} Goals`}
                      </h2>
                      <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">
                        {list.length}
                      </span>
                    </div>
                    <div className="rounded-lg border border-border">
                      <ul className="divide-y divide-border">
                        {list.map((g) => (
                          <GoalRow
                            key={g.id}
                            goal={g}
                            onEdit={(g) => setGoalModal({ open: true, goal: g })}
                            onAddCheckpoint={(goalId) => setCpModal({ open: true, goalId })}
                            onEditCheckpoint={(goalId, cp) => setCpModal({ open: true, goalId, checkpoint: cp })}
                          />
                        ))}
                      </ul>
                    </div>
                  </section>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <GoalModal
        open={goalModal.open}
        onClose={() => setGoalModal({ open: false })}
        goal={goalModal.goal}
      />
      <CheckpointModal
        open={cpModal.open}
        onClose={() => setCpModal({ open: false, goalId: '' })}
        goalId={cpModal.goalId}
        checkpoint={cpModal.checkpoint}
      />
    </div>
  )
}
