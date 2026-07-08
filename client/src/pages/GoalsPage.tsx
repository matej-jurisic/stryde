import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Check, MoreHorizontal } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { goalsApi, checkpointsApi, ApiError } from '@/lib/api'
import type { Goal, GoalStatus, Checkpoint, CheckpointSize } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { GoalModal } from '@/components/goals/GoalModal'
import { CheckpointModal } from '@/components/goals/CheckpointModal'

// ── helpers ────────────────────────────────────────────────────────────────

const STATUS_ORDER: GoalStatus[] = ['focus', 'active', 'bench', 'closed']

type Tier = 'focus' | 'active' | 'bench'
const TIER_META: Record<Tier, { label: string; dot: string; badge: 'focus' | 'active' | 'bench' }> = {
  focus:  { label: 'Focus',  dot: 'bg-goal-focus',  badge: 'focus' },
  active: { label: 'Active', dot: 'bg-goal-active',  badge: 'active' },
  bench:  { label: 'Bench',  dot: 'bg-goal-bench',   badge: 'bench' },
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

function ProgressBar({ value, tier }: { value: number; tier: Tier }) {
  const colors: Record<Tier, string> = {
    focus:  'bg-goal-focus',
    active: 'bg-goal-active',
    bench:  'bg-goal-bench',
  }
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={`absolute inset-y-0 left-0 rounded-full ${colors[tier]} transition-all`}
        style={{ width: `${Math.min(value, 100)}%` }}
      />
    </div>
  )
}

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
        <div className="flex shrink-0 items-center gap-0.5 transition-opacity opacity-100 md:opacity-0 group-hover:opacity-100">
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

function StatusDropdown({
  transitions,
  isPending,
  onSelect,
}: {
  transitions: { label: string; value: GoalStatus }[]
  isPending: boolean
  onSelect: (value: GoalStatus) => void
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
        title="Change status"
      >
        <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-50 mb-1 min-w-[148px] rounded-lg border border-border bg-card py-1 shadow-pop">
          {transitions.map((t) => (
            <button
              key={t.value}
              onClick={() => { onSelect(t.value); setOpen(false) }}
              className="w-full px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted transition-colors"
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface GoalCardProps {
  goal: Goal
  onEdit: (g: Goal) => void
  onAddCheckpoint: (goalId: string) => void
  onEditCheckpoint: (goalId: string, cp: Checkpoint) => void
}

function GoalCard({ goal, onEdit, onAddCheckpoint, onEditCheckpoint }: GoalCardProps) {
  const qc = useQueryClient()
  const [statusError, setStatusError] = useState('')
  const tier = (goal.status === 'closed' ? 'bench' : goal.status) as Tier
  const believed = believedProgress(goal.checkpoints)
  const transitions = STATUS_TRANSITIONS[goal.status]

  // Goal changes ripple into event badges and recommendation tiers
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
    <article className="flex flex-col rounded-lg border border-border bg-card p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-foreground truncate">{goal.title}</h3>
          {goal.description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{goal.description}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {goal.status !== 'closed' && (
            <Badge tone={TIER_META[tier].badge}>
              <span className={`h-1.5 w-1.5 rounded-full ${TIER_META[tier].dot}`} />
              {TIER_META[tier].label}
            </Badge>
          )}
          {goal.status === 'closed' && <Badge tone="neutral">Closed</Badge>}
          <button
            onClick={() => onEdit(goal)}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
          <button
            onClick={() => deleteMutation.mutate()}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Progress */}
      {goal.status !== 'closed' && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium">
            <span className="text-muted-foreground">Believed progress</span>
            <span className="text-foreground">{Math.round(believed)}%</span>
          </div>
          <ProgressBar value={believed} tier={tier} />
        </div>
      )}

      {/* Checkpoints */}
      {goal.checkpoints.length > 0 && (
        <div className="mt-5">
          <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Checkpoints · {goal.checkpoints.filter((c) => c.status === 'reached').length}/{goal.checkpoints.length}
          </p>
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
        </div>
      )}

      {/* Footer: add checkpoint + status transitions */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <button
          onClick={() => onAddCheckpoint(goal.id)}
          className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-primary transition-colors"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
          Add checkpoint
        </button>
        <div className="ml-auto">
          <StatusDropdown
            transitions={transitions}
            isPending={statusMutation.isPending}
            onSelect={(status) => statusMutation.mutate(status)}
          />
        </div>
      </div>

      {statusError && <p className="mt-2 text-xs text-destructive">{statusError}</p>}
    </article>
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
          <Button size="sm" onClick={() => setGoalModal({ open: true })}>
            <Plus className="mr-1.5 h-3.5 w-3.5" strokeWidth={2.5} />
            New Goal
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
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
            <Button size="sm" onClick={() => setGoalModal({ open: true })}>New Goal</Button>
          </div>
        ) : (
          <div className="flex flex-col gap-10">
            {(['focus', 'active', 'bench', 'closed'] as GoalStatus[]).map((status) => {
              const list = grouped[status]
              if (list.length === 0) return null
              const tier = (status === 'closed' ? 'bench' : status) as Tier
              return (
                <section key={status}>
                  <div className="mb-4 flex items-center gap-2">
                    {status !== 'closed' && <span className={`h-2 w-2 rounded-full ${TIER_META[tier].dot}`} />}
                    <h2 className="text-sm font-semibold text-foreground">
                      {status === 'closed' ? 'Closed' : `${TIER_META[tier].label} Goals`}
                    </h2>
                    <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">
                      {list.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {list.map((g) => (
                      <GoalCard
                        key={g.id}
                        goal={g}
                        onEdit={(g) => setGoalModal({ open: true, goal: g })}
                        onAddCheckpoint={(goalId) => setCpModal({ open: true, goalId })}
                        onEditCheckpoint={(goalId, cp) => setCpModal({ open: true, goalId, checkpoint: cp })}
                      />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
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
