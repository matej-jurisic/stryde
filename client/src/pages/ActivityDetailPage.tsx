import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Pencil, Trash2, Plus, X } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CategoryIcon } from '@/components/categories/categoryIcons'
import { ActivityModal } from '@/components/activities/ActivityModal'
import { activitiesApi, activitySubtasksApi, occurrencesApi, goalsApi, categoriesApi } from '@/lib/api'
import type { Activity, Occurrence } from '@/lib/types'

const GOAL_TONE: Record<string, 'focus' | 'active' | 'bench' | 'neutral'> = {
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

function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">{count}</span>
    </div>
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

export function ActivityDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [editModal, setEditModal] = useState(false)
  const [subtasks, setSubtasks] = useState<Activity['subtasks'] | null>(null)
  const [newSubtask, setNewSubtask] = useState('')

  const { data: activity, isLoading } = useQuery({
    queryKey: ['activities', id],
    queryFn: () => activitiesApi.get(id!),
    enabled: !!id,
    initialData: () => qc.getQueryData<Activity[]>(['activities'])?.find(a => a.id === id),
    initialDataUpdatedAt: () => qc.getQueryState(['activities'])?.dataUpdatedAt,
  })

  const { data: goals = [] } = useQuery({
    queryKey: ['goals'],
    queryFn: () => goalsApi.list(),
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list(),
  })

  const { data: occurrences = [], isLoading: loadingOccurrences } = useQuery({
    queryKey: ['events', 'activity', id],
    queryFn: () => occurrencesApi.list({ activityId: id! }),
    enabled: !!id,
  })

  const displaySubtasks = subtasks ?? activity?.subtasks ?? []

  const addSubtaskMutation = useMutation({
    mutationFn: (title: string) => activitySubtasksApi.create(id!, { title }),
    onSuccess: (created) => {
      setSubtasks((prev) => [...(prev ?? activity?.subtasks ?? []), created])
      setNewSubtask('')
    },
  })

  const deleteSubtaskMutation = useMutation({
    mutationFn: (subtaskId: string) => activitySubtasksApi.delete(id!, subtaskId),
    onSuccess: (_, subtaskId) => {
      setSubtasks((prev) => (prev ?? activity?.subtasks ?? []).filter((s) => s.id !== subtaskId))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => activitiesApi.delete(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['activities'] })
      navigate('/activities')
    },
  })

  function handleAddSubtask() {
    const t = newSubtask.trim()
    if (!t) return
    addSubtaskMutation.mutate(t)
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <PageHeader
          title="Activity"
          leading={
            <button onClick={() => navigate('/activities')} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
              <ArrowLeft className="h-4 w-4" strokeWidth={2} />
            </button>
          }
        />
        <Spinner />
      </div>
    )
  }

  if (!activity) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <PageHeader
          title="Activity not found"
          leading={
            <button onClick={() => navigate('/activities')} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
              <ArrowLeft className="h-4 w-4" strokeWidth={2} />
            </button>
          }
        />
        <p className="px-6 py-8 text-sm text-muted-foreground">This activity could not be found.</p>
      </div>
    )
  }

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
            onClick={() => navigate('/activities')}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={2} />
          </button>
        }
        title={activity.title}
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
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">{activity.title}</span>
            {activity.category && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CategoryIcon icon={activity.category.icon} color={activity.category.color} size={12} strokeWidth={2} />
                {activity.category.name}
              </span>
            )}
            {activity.goal && (
              <Badge tone={GOAL_TONE[activity.goal.status] ?? 'neutral'}>
                {activity.goal.title}
              </Badge>
            )}
          </div>

          {/* Subtasks */}
          <div className="flex flex-col gap-3">
            <SectionHeading label="Subtasks" count={displaySubtasks.length} />
            {displaySubtasks.length > 0 && (
              <div className="rounded-lg border border-border">
                <ul className="divide-y divide-border">
                  {displaySubtasks.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                      <span className="flex-1 text-sm text-foreground">{s.title}</span>
                      <button
                        onClick={() => deleteSubtaskMutation.mutate(s.id)}
                        className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Add a subtask..."
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddSubtask() } }}
                className="h-9 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <Button
                variant="ghost"
                onClick={handleAddSubtask}
                disabled={!newSubtask.trim() || addSubtaskMutation.isPending}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                Add
              </Button>
            </div>
          </div>

          {/* Occurrences */}
          <div className="flex flex-col gap-3">
            <SectionHeading label="Occurrences" count={occurrences.length} />
            {loadingOccurrences ? (
              <Spinner />
            ) : sortedOccurrences.length === 0 ? (
              <p className="text-xs text-muted-foreground">No occurrences for this activity yet.</p>
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

      <ActivityModal
        key={activity.id}
        open={editModal}
        onClose={() => {
          setEditModal(false)
          qc.invalidateQueries({ queryKey: ['activities', id] })
          setSubtasks(null)
        }}
        activity={activity}
        goals={goals}
        categories={categories}
      />
    </div>
  )
}
