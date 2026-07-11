import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { occurrencesApi } from '@/lib/api'
import type { Occurrence } from '@/lib/types'

interface Props {
  open: boolean
  onClose: () => void
  occurrence: Occurrence
}

export function OccurrenceSubtasksModal({ open, onClose, occurrence }: Props) {
  const qc = useQueryClient()
  const [completedIds, setCompletedIds] = useState(() => new Set(occurrence.completedSubtaskIds))

  useEffect(() => {
    setCompletedIds(new Set(occurrence.completedSubtaskIds))
  }, [occurrence.completedSubtaskIds])

  const toggleMutation = useMutation({
    mutationFn: (subtaskId: string) => occurrencesApi.toggleSubtask(occurrence.id, subtaskId),
    onMutate: (subtaskId) => {
      setCompletedIds((prev) => {
        const next = new Set(prev)
        if (next.has(subtaskId)) next.delete(subtaskId); else next.add(subtaskId)
        return next
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
    onError: (_, subtaskId) => {
      setCompletedIds((prev) => {
        const next = new Set(prev)
        if (next.has(subtaskId)) next.delete(subtaskId); else next.add(subtaskId)
        return next
      })
    },
  })

  const subtasks = occurrence.activity.subtasks
  const doneCount = subtasks.filter((s) => completedIds.has(s.id)).length

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Subtasks (${doneCount}/${subtasks.length})`}
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}
    >
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {subtasks.map((s) => {
          const done = completedIds.has(s.id)
          return (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
              <button
                onClick={() => toggleMutation.mutate(s.id)}
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
                  done
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background hover:border-primary'
                }`}
              >
                {done && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
              </button>
              <span className={`flex-1 text-sm ${done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                {s.title}
              </span>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
