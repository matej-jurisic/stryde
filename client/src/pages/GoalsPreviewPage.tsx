import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Pencil, Trash2, Check } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { goalsApi, checkpointsApi, ApiError } from '@/lib/api'
import { toastError } from '@/store/toasts'
import type { Goal, GoalStatus, Checkpoint, CheckpointSize } from '@/lib/types'
import { OccurrenceBar } from '@/components/goals/OccurrenceBar'
import { GoalModal } from '@/components/goals/GoalModal'
import { CheckpointModal } from '@/components/goals/CheckpointModal'
import { ActionMenu, type ActionMenuEntry } from '@/components/ui/ActionMenu'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

// ── helpers ────────────────────────────────────────────────────────────────

const STATUS_ORDER: GoalStatus[] = ['focus', 'active', 'bench', 'closed']

type Tier = 'focus' | 'active' | 'bench'
const TIER_META: Record<Tier, { label: string; dot: string; varName: string }> = {
  focus: { label: 'Focus', dot: 'bg-goal-focus', varName: 'var(--color-goal-focus)' },
  active: { label: 'Active', dot: 'bg-goal-active', varName: 'var(--color-goal-active)' },
  bench: { label: 'Bench', dot: 'bg-goal-bench', varName: 'var(--color-goal-bench)' },
}

const SIZE_WEIGHT: Record<CheckpointSize, number> = { tiny: 1, small: 2, normal: 3, big: 5, huge: 8 }

function believedProgress(checkpoints: Checkpoint[]): number {
  const total = checkpoints.reduce((sum, c) => sum + SIZE_WEIGHT[c.size], 0)
  if (total === 0) return 0
  const reached = checkpoints.filter((c) => c.status === 'reached').reduce((sum, c) => sum + SIZE_WEIGHT[c.size], 0)
  return (reached / total) * 100
}

function dayMs(iso: string): number {
  // targetDate is stored as a full ISO string; parse it directly.
  return new Date(iso).getTime()
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi)
}

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function lastDoneLabel(lastAt: string | null): string {
  if (!lastAt) return 'no sessions yet'
  const days = Math.floor((Date.now() - new Date(lastAt).getTime()) / 86400000)
  if (days === 0) return 'active today'
  if (days === 1) return 'active yesterday'
  if (days < 7) return `active ${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w since last`
  return `${Math.floor(days / 30)}mo since last`
}

const STATUS_TRANSITIONS: Record<GoalStatus, { label: string; value: GoalStatus }[]> = {
  focus: [{ label: 'Move to Active', value: 'active' }, { label: 'Move to Bench', value: 'bench' }, { label: 'Close', value: 'closed' }],
  active: [{ label: 'Move to Focus', value: 'focus' }, { label: 'Move to Bench', value: 'bench' }, { label: 'Close', value: 'closed' }],
  bench: [{ label: 'Move to Active', value: 'active' }, { label: 'Move to Focus', value: 'focus' }, { label: 'Close', value: 'closed' }],
  closed: [{ label: 'Reopen', value: 'active' }],
}

// ── Progress ring ────────────────────────────────────────────────────────────

function ProgressRing({ pct, color, size = 52, stroke = 5, children }: { pct: number; color: string; size?: number; stroke?: number; children?: React.ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const dash = (clamp(pct, 0, 100) / 100) * c
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-muted)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${dash} ${c}`} className="transition-all duration-500" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {children ?? <span className="font-mono text-[11px] font-medium text-foreground tabular-nums">{Math.round(pct)}%</span>}
      </div>
    </div>
  )
}

// ── Checkpoint breakdown ────────────────────────────────────────────────────────
// Checkpoints are unordered, weighted, and almost never dated — so the visual is
// a weight-proportional composition bar plus a toggleable chip list, not a time axis.

const SIZE_DOT: Record<CheckpointSize, number> = { tiny: 5, small: 6, normal: 8, big: 10, huge: 13 }

// Shared toggle/delete mutations + delete-confirm state for a single checkpoint.
// Used by both the desktop chip and the mobile list row.
function useCheckpointActions(goalId: string, cp: Checkpoint) {
  const qc = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const reached = cp.status === 'reached'

  const toggle = useMutation({
    mutationFn: () => checkpointsApi.setStatus(goalId, cp.id, reached ? 'pending' : 'reached'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
    onError: (err) => toastError(err, 'Could not update the checkpoint.'),
  })

  const del = useMutation({
    mutationFn: () => checkpointsApi.delete(goalId, cp.id),
    onSuccess: () => {
      setConfirmDelete(false)
      qc.invalidateQueries({ queryKey: ['goals'] })
    },
    onError: (err) => toastError(err, 'Could not delete the checkpoint.'),
  })

  return { reached, toggle, del, confirmDelete, setConfirmDelete }
}

function CheckpointDeleteDialog({ cp, del, confirmDelete, setConfirmDelete }: {
  cp: Checkpoint
  del: ReturnType<typeof useCheckpointActions>['del']
  confirmDelete: boolean
  setConfirmDelete: (v: boolean) => void
}) {
  return (
    <ConfirmDialog
      open={confirmDelete}
      onClose={() => setConfirmDelete(false)}
      onConfirm={() => del.mutate()}
      loading={del.isPending}
      title="Delete checkpoint?"
      message={`"${cp.title}" will be permanently deleted.`}
    />
  )
}

// Desktop: a rounded chip. Click the label to toggle reached; the menu edits or deletes.
function CheckpointChip({ goalId, cp, tierColor, onEdit }: { goalId: string; cp: Checkpoint; tierColor: string; onEdit: (cp: Checkpoint) => void }) {
  const { reached, toggle, del, confirmDelete, setConfirmDelete } = useCheckpointActions(goalId, cp)
  const dot = SIZE_DOT[cp.size]

  return (
    <div
      className="flex items-center rounded-full border py-0.5 pl-2 pr-0.5 transition-colors"
      style={{ borderColor: reached ? tierColor : 'var(--color-border)', background: reached ? `${tierColor}14` : 'transparent' }}
    >
      <button
        onClick={() => toggle.mutate()}
        title={`${cp.size}${cp.targetDate ? ` · due ${shortDate(dayMs(cp.targetDate))}` : ''} · toggle reached`}
        className="flex items-center gap-1.5 text-[11px]"
      >
        <span
          className="shrink-0 rounded-full"
          style={{ width: dot, height: dot, background: reached ? tierColor : 'transparent', border: `1.5px solid ${tierColor}` }}
        />
        <span className={reached ? 'text-muted-foreground line-through' : 'text-foreground'}>{cp.title}</span>
        {cp.targetDate && <span className="text-[9px] text-muted-foreground/60">{shortDate(dayMs(cp.targetDate))}</span>}
      </button>
      <ActionMenu
        triggerClassName="ml-1 shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        iconClassName="h-3 w-3"
        items={[
          { icon: Pencil, label: 'Edit', onClick: () => onEdit(cp) },
          { icon: Trash2, label: 'Delete', onClick: () => setConfirmDelete(true), destructive: true },
        ]}
      />
      <CheckpointDeleteDialog cp={cp} del={del} confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete} />
    </div>
  )
}

// Mobile: a full-width checklist row. The circle is the reached toggle.
function CheckpointListRow({ goalId, cp, tierColor, onEdit }: { goalId: string; cp: Checkpoint; tierColor: string; onEdit: (cp: Checkpoint) => void }) {
  const { reached, toggle, del, confirmDelete, setConfirmDelete } = useCheckpointActions(goalId, cp)

  return (
    <div className="flex items-center gap-2.5 py-1">
      <button
        onClick={() => toggle.mutate()}
        aria-label={reached ? 'Mark checkpoint pending' : 'Mark checkpoint reached'}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors"
        style={{ borderColor: tierColor, background: reached ? tierColor : 'transparent' }}
      >
        {reached && <Check className="h-2.5 w-2.5 text-background" strokeWidth={3} />}
      </button>
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className={`truncate text-[13px] ${reached ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{cp.title}</span>
        <span className="shrink-0 text-[10px] capitalize text-muted-foreground/70">{cp.size}</span>
        {cp.targetDate && <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60">{shortDate(dayMs(cp.targetDate))}</span>}
      </div>
      <ActionMenu
        triggerClassName="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        iconClassName="h-3.5 w-3.5"
        items={[
          { icon: Pencil, label: 'Edit', onClick: () => onEdit(cp) },
          { icon: Trash2, label: 'Delete', onClick: () => setConfirmDelete(true), destructive: true },
        ]}
      />
      <CheckpointDeleteDialog cp={cp} del={del} confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete} />
    </div>
  )
}

function CheckpointBreakdown({ goal, tierColor, onEditCheckpoint }: { goal: Goal; tierColor: string; onEditCheckpoint: (cp: Checkpoint) => void }) {
  const cps = goal.checkpoints

  return (
    <div className="flex flex-col gap-2.5">
      {/* Weighted composition bar: each segment sized by its checkpoint's weight */}
      <div className="flex h-2.5 gap-px overflow-hidden rounded-full bg-muted">
        {cps.map((c) => {
          const reached = c.status === 'reached'
          return (
            <div
              key={c.id}
              title={`${c.title} · ${c.size}${reached ? ' · reached' : ''}`}
              className="h-full transition-colors first:rounded-l-full last:rounded-r-full"
              style={{ flexGrow: SIZE_WEIGHT[c.size], flexBasis: 0, minWidth: 3, background: reached ? tierColor : 'var(--color-muted)' }}
            />
          )
        })}
      </div>

      {/* Mobile: full-width checklist (pills wrap into an awkward pseudo-list on narrow screens) */}
      <div className="flex flex-col divide-y divide-border/60 sm:hidden">
        {cps.map((c) => (
          <CheckpointListRow key={c.id} goalId={goal.id} cp={c} tierColor={tierColor} onEdit={onEditCheckpoint} />
        ))}
      </div>

      {/* Desktop: chips. Click the label to toggle reached; the menu edits or deletes */}
      <div className="hidden flex-wrap gap-1.5 sm:flex">
        {cps.map((c) => (
          <CheckpointChip key={c.id} goalId={goal.id} cp={c} tierColor={tierColor} onEdit={onEditCheckpoint} />
        ))}
      </div>
    </div>
  )
}

// ── Goal card ──────────────────────────────────────────────────────────────

interface GoalCardProps {
  goal: Goal
  onView: (g: Goal) => void
  onEdit: (g: Goal) => void
  onAddCheckpoint: (goalId: string) => void
  onEditCheckpoint: (goalId: string, cp: Checkpoint) => void
}

function GoalCard({ goal, onView, onEdit, onAddCheckpoint, onEditCheckpoint }: GoalCardProps) {
  const qc = useQueryClient()
  const [statusError, setStatusError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const tier = (goal.status === 'closed' ? 'bench' : goal.status) as Tier
  const tierColor = TIER_META[tier].varName
  const isMilestone = goal.kind === 'milestone'
  const believed = believedProgress(goal.checkpoints)
  const transitions = STATUS_TRANSITIONS[goal.status]
  const hasCheckpoints = goal.checkpoints.length > 0
  const isClosed = goal.status === 'closed'

  const deleteMutation = useMutation({
    mutationFn: () => goalsApi.delete(goal.id),
    onSuccess: () => {
      setConfirmDelete(false)
      qc.invalidateQueries({ queryKey: ['goals'] })
      qc.invalidateQueries({ queryKey: ['events'] })
    },
    onError: (err) => toastError(err, 'Could not delete the goal.'),
  })

  const statusMutation = useMutation({
    mutationFn: (status: GoalStatus) => goalsApi.setStatus(goal.id, status),
    onSuccess: () => {
      setStatusError('')
      qc.invalidateQueries({ queryKey: ['goals'] })
      qc.invalidateQueries({ queryKey: ['events'] })
    },
    onError: (err) => setStatusError(err instanceof ApiError ? err.message : 'Something went wrong.'),
  })

  return (
    <div className={`rounded-xl border border-border p-4 transition-opacity ${isClosed ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-3">
        {/* Progress signal */}
        {isMilestone ? (
          <ProgressRing pct={believed} color={tierColor} />
        ) : (
          <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: tierColor }} />
        )}

        {/* Title block */}
        <div className="min-w-0 flex-1">
          <button onClick={() => onView(goal)} className="block text-left">
            <span className="text-sm font-semibold text-foreground hover:underline">{goal.title}</span>
          </button>
          {goal.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{goal.description}</p>}
          {(isMilestone ? hasCheckpoints : goal.lastOccurrenceAt) && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              {isMilestone ? (
                <span>{goal.checkpoints.filter((c) => c.status === 'reached').length}/{goal.checkpoints.length} checkpoints</span>
              ) : (
                <span>{lastDoneLabel(goal.lastOccurrenceAt)}</span>
              )}
            </div>
          )}
        </div>

        <ActionMenu
          disabled={statusMutation.isPending}
          triggerClassName="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
          iconClassName="h-3.5 w-3.5"
          items={[
            { icon: Pencil, label: 'Edit goal', onClick: () => onEdit(goal) },
            { icon: Plus, label: 'Add checkpoint', onClick: () => onAddCheckpoint(goal.id) },
            ...(transitions.length > 0 ? ['separator' as const] : []),
            ...transitions.map((t): ActionMenuEntry => ({ label: t.label, onClick: () => statusMutation.mutate(t.value) })),
            'separator',
            { icon: Trash2, label: 'Delete goal', onClick: () => setConfirmDelete(true), destructive: true },
          ]}
        />
      </div>

      {/* Body */}
      {(isMilestone ? hasCheckpoints : !!goal.occurrenceStats) && (
        <div className="mt-3">
          {isMilestone ? (
            <CheckpointBreakdown goal={goal} tierColor={tierColor} onEditCheckpoint={(cp) => onEditCheckpoint(goal.id, cp)} />
          ) : (
            <div className="flex items-center gap-3">
              <OccurrenceBar stats={goal.occurrenceStats!} barClassName="flex-1 h-1.5" labelClassName="w-10" />
            </div>
          )}
        </div>
      )}

      {statusError && <p className="mt-2 text-xs text-destructive">{statusError}</p>}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => deleteMutation.mutate()}
        loading={deleteMutation.isPending}
        title="Delete goal?"
        message={`"${goal.title}" and its checkpoints will be permanently deleted. Linked activities and occurrences will be kept without a goal.`}
      />
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export function GoalsPreviewPage() {
  const navigate = useNavigate()
  const [goalModal, setGoalModal] = useState<{ open: boolean; goal?: Goal }>({ open: false })
  const [cpModal, setCpModal] = useState<{ open: boolean; goalId: string; checkpoint?: Checkpoint }>({ open: false, goalId: '' })

  const { data: goals = [], isLoading } = useQuery({ queryKey: ['goals'], queryFn: () => goalsApi.list() })

  const grouped = STATUS_ORDER.reduce<Record<GoalStatus, Goal[]>>(
    (acc, s) => { acc[s] = goals.filter((g) => g.status === s); return acc },
    { focus: [], active: [], bench: [], closed: [] },
  )

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Goals"
        action={
          <button onClick={() => setGoalModal({ open: true })} className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-foreground hover:bg-muted transition-colors">
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
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
              <button onClick={() => setGoalModal({ open: true })} className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted transition-colors">
                <Plus className="h-3.5 w-3.5" strokeWidth={2} /> New Goal
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {STATUS_ORDER.map((status) => {
                const list = grouped[status]
                if (list.length === 0) return null
                const tier = (status === 'closed' ? 'bench' : status) as Tier
                return (
                  <section key={status}>
                    <div className="mb-2.5 flex items-center gap-2 px-1">
                      {status !== 'closed' && <span className={`h-1.5 w-1.5 rounded-full ${TIER_META[tier].dot}`} />}
                      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {status === 'closed' ? 'Closed' : `${TIER_META[tier].label} Goals`}
                      </h2>
                      <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">{list.length}</span>
                    </div>
                    <div className="flex flex-col gap-3">
                      {list.map((g) => (
                        <GoalCard
                          key={g.id}
                          goal={g}
                          onView={(g) => navigate(`/goals/${g.id}`)}
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
      </div>

      <GoalModal open={goalModal.open} onClose={() => setGoalModal({ open: false })} goal={goalModal.goal} />
      <CheckpointModal open={cpModal.open} onClose={() => setCpModal({ open: false, goalId: '' })} goalId={cpModal.goalId} checkpoint={cpModal.checkpoint} />
    </div>
  )
}
