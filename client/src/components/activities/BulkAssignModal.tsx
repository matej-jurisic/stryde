import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { activitiesApi } from '@/lib/api'
import { toastError } from '@/store/toasts'
import type { Activity, ActivityType, Category, Goal } from '@/lib/types'
import { ACTIVITY_TYPES } from '@/lib/activityTypes'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'

/** Sentinel select values: empty = leave the field alone, CLEAR = set it to null. */
const KEEP = ''
const CLEAR = '__clear__'

interface BulkAssignModalProps {
  open: boolean
  onClose: () => void
  activities: Activity[]
  goals: Goal[]
  categories: Category[]
  onApplied: () => void
}

export function BulkAssignModal({
  open,
  onClose,
  activities,
  goals,
  categories,
  onApplied,
}: BulkAssignModalProps) {
  const qc = useQueryClient()
  const [type, setType] = useState(KEEP)
  const [goalId, setGoalId] = useState(KEEP)
  const [categoryId, setCategoryId] = useState(KEEP)

  const dirty = type !== KEEP || goalId !== KEEP || categoryId !== KEEP

  // No bulk endpoint exists; the PUT is a full replace, so unchanged fields are
  // resent from the activity itself.
  const mutation = useMutation({
    mutationFn: () =>
      Promise.all(
        activities.map((a) =>
          activitiesApi.update(a.id, {
            title: a.title,
            type: type === KEEP ? a.type : (type as ActivityType),
            goalId: goalId === KEEP ? a.goalId : goalId === CLEAR ? null : goalId,
            categoryId:
              categoryId === KEEP ? a.categoryId : categoryId === CLEAR ? null : categoryId,
            excludeFromRecommendations: a.excludeFromRecommendations,
          }),
        ),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['activities'] })
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
      onApplied()
      onClose()
    },
    onError: (err) => toastError(err, 'Could not update the selected activities.'),
  })

  const activeGoals = goals.filter((g) => g.status !== 'closed')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Assign ${activities.length} ${activities.length === 1 ? 'activity' : 'activities'}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!dirty}>
            Apply
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        Fields left on "Keep current" are not touched.
      </p>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground">Type</label>
        <Select
          value={type}
          onChange={setType}
          options={[
            { value: KEEP, label: 'Keep current' },
            ...ACTIVITY_TYPES.map((t) => ({ value: t.value, label: t.label })),
          ]}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground">Goal</label>
        <Select
          value={goalId}
          onChange={setGoalId}
          options={[
            { value: KEEP, label: 'Keep current' },
            { value: CLEAR, label: 'No goal' },
            ...activeGoals.map((g) => ({ value: g.id, label: g.title })),
          ]}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground">Category</label>
        <Select
          value={categoryId}
          onChange={setCategoryId}
          options={[
            { value: KEEP, label: 'Keep current' },
            { value: CLEAR, label: 'No category' },
            ...categories.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
      </div>
    </Modal>
  )
}
