import { useState, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { activitiesApi, activitySubtasksApi } from '@/lib/api'
import type { Activity, ActivityStateEffect, Goal, Category } from '@/lib/types'
import { NO_TYPE_LABEL, profileHint } from '@/lib/activityTypes'
import { useActivityTypes } from '@/lib/useActivityTypes'
import { useStates } from '@/lib/useStates'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { StateEffectPicker } from './StateEffectPicker'
import { StateValuePicker } from './StateValuePicker'
import { ActivityTypeIcon } from './ActivityTypeIcon'

function TypeChip({
  label,
  icon,
  selected,
  onClick,
}: {
  label: string
  icon: string | null
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
        selected
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-input text-muted-foreground hover:bg-muted'
      }`}
    >
      <ActivityTypeIcon icon={icon} className="h-3.5 w-3.5 shrink-0" />
      {label}
    </button>
  )
}

interface ActivityModalProps {
  open: boolean
  onClose: () => void
  activity?: Activity
  goals: Goal[]
  categories: Category[]
}

export function ActivityModal({ open, onClose, activity, goals, categories }: ActivityModalProps) {
  const qc = useQueryClient()
  const isEdit = Boolean(activity)
  const [title, setTitle] = useState(activity?.title ?? '')
  const [goalId, setGoalId] = useState(activity?.goalId ?? '')
  const [categoryId, setCategoryId] = useState(activity?.categoryId ?? '')
  const [excludeFromRecommendations, setExcludeFromRecommendations] = useState(activity?.excludeFromRecommendations ?? false)
  const [activityTypeId, setActivityTypeId] = useState<string | null>(activity?.activityTypeId ?? null)
  const [titleError, setTitleError] = useState('')
  const [subtasks, setSubtasks] = useState(activity?.subtasks ?? [])
  const [newSubtask, setNewSubtask] = useState('')
  const newSubtaskRef = useRef<HTMLInputElement>(null)
  const types = useActivityTypes()
  const { states } = useStates()
  const [sets, setSets] = useState<ActivityStateEffect[]>(activity?.setsStateValues ?? [])
  const [requires, setRequires] = useState<string[]>(activity?.requiredStateValueIds ?? [])

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        title: title.trim(),
        goalId: goalId || null,
        categoryId: categoryId || null,
        activityTypeId,
        setsStateValues: sets,
        requiredStateValueIds: requires,
      }
      return isEdit
        ? activitiesApi.update(activity!.id, { ...body, excludeFromRecommendations })
        : activitiesApi.create(body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['activities'] })
      // State requirements decide whether an activity is suggested at all, so the panel is stale
      // the moment they change.
      qc.invalidateQueries({ queryKey: ['recommendations'] })
      // Occurrences embed their activity: the title feeds `effectiveTitle` and the category feeds
      // every list row's and calendar block's colour, so both go stale on an activity write.
      qc.invalidateQueries({ queryKey: ['events'] })
      onClose()
    },
  })

  const addSubtaskMutation = useMutation({
    mutationFn: (subtaskTitle: string) => activitySubtasksApi.create(activity!.id, { title: subtaskTitle }),
    onSuccess: (created) => { setSubtasks((prev) => [...prev, created]); setNewSubtask('') },
  })

  const deleteSubtaskMutation = useMutation({
    mutationFn: (id: string) => activitySubtasksApi.delete(activity!.id, id),
    onSuccess: (_, id) => { setSubtasks((prev) => prev.filter((s) => s.id !== id)) },
  })

  function handleSubmit() {
    if (!title.trim()) { setTitleError('Title is required.'); return }
    if (title.length > 255) { setTitleError('Title cannot exceed 255 characters.'); return }
    setTitleError('')
    mutation.mutate()
  }

  function handleAddSubtask() {
    const t = newSubtask.trim()
    if (!t) return
    addSubtaskMutation.mutate(t)
  }

  const activeGoals = goals.filter((g) => g.status !== 'closed')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Activity' : 'New Activity'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button onClick={handleSubmit} loading={mutation.isPending}>{isEdit ? 'Save Changes' : 'Create'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground">Title</label>
        <input
          type="text"
          placeholder="e.g. Morning run, Deep work session"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
          autoFocus
          className={`h-11 rounded-lg border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring ${
            titleError ? 'border-destructive' : 'border-input'
          }`}
        />
        {titleError && <p className="text-xs text-destructive">{titleError}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground">Type</label>
        {/* Chips rather than tiles: six of them stacked two rows deep pushed the rest of the form
            below the fold on a phone. */}
        <div className="flex flex-wrap gap-1.5">
          {/* "No type" is a chip of its own rather than an absent selection: it is the unconstrained
              profile, which is a choice, not a blank. */}
          <TypeChip
            label={NO_TYPE_LABEL}
            icon={null}
            selected={activityTypeId === null}
            onClick={() => setActivityTypeId(null)}
          />
          {(types ?? []).map((t) => (
            <TypeChip
              key={t.id}
              label={t.name}
              icon={t.icon}
              selected={activityTypeId === t.id}
              onClick={() => setActivityTypeId(t.id)}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {profileHint(types?.find((t) => t.id === activityTypeId))}
        </p>
      </div>

      {/* Hidden entirely until the user has defined a state: two empty pickers on every activity form
          would be pure noise for anyone who never opens the States section. */}
      {states.some((s) => s.values.length > 0) && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">
            States <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          {/* One panel, not two loose fields. Both halves render the same chips off the same
              states, so side by side as bare labelled rows they read as one repeated control;
              the divider and the sub-labels are what say which half is the condition and which
              is the consequence. */}
          <div className="divide-y divide-border rounded-lg border border-border bg-muted/40">
            <div className="flex flex-col gap-2 p-3">
              <p className="text-xs font-medium text-foreground">Only suggest when</p>
              <StateValuePicker states={states} value={requires} onChange={setRequires} />
            </div>
            <div className="flex flex-col gap-2 p-3">
              <p className="text-xs font-medium text-foreground">Doing it changes</p>
              <StateEffectPicker states={states} value={sets} onChange={setSets} />
            </div>
          </div>
        </div>
      )}

      {activeGoals.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">
            Goal <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <select
            value={goalId}
            onChange={(e) => setGoalId(e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">No goal</option>
            {activeGoals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </div>
      )}

      {categories.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">
            Category <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">No category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={excludeFromRecommendations}
          onChange={(e) => setExcludeFromRecommendations(e.target.checked)}
          className="h-4 w-4 rounded border-input accent-primary"
        />
        <span className="text-sm text-foreground">Exclude from suggestions</span>
      </label>

      {isEdit && (
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-foreground">Subtasks</label>
          {subtasks.length > 0 && (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {subtasks.map((s) => (
                <li key={s.id} className="flex items-center gap-2 px-3 py-2">
                  <span className="flex-1 text-sm text-foreground">{s.title}</span>
                  <button
                    onClick={() => deleteSubtaskMutation.mutate(s.id)}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input
              ref={newSubtaskRef}
              type="text"
              placeholder="Add a subtask..."
              value={newSubtask}
              onChange={(e) => setNewSubtask(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddSubtask() } }}
              className="h-9 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <Button variant="ghost" onClick={handleAddSubtask} disabled={!newSubtask.trim() || addSubtaskMutation.isPending}>
              Add
            </Button>
          </div>
        </div>
      )}

      {mutation.error instanceof Error && (
        <p className="text-sm text-destructive">{mutation.error.message}</p>
      )}
    </Modal>
  )
}
