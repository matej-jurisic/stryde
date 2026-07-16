import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Trash2, Plus } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { occurrencesApi, occurrenceSubtasksApi } from '@/lib/api'
import { toastError } from '@/store/toasts'
import type { Occurrence, OccurrenceSubtask } from '@/lib/types'

interface Props {
  open: boolean
  onClose: () => void
  occurrence: Occurrence
}

export function OccurrenceSubtasksModal({ open, onClose, occurrence }: Props) {
  const qc = useQueryClient()
  const [subtasks, setSubtasks] = useState<OccurrenceSubtask[]>(occurrence.subtasks)
  const [newTitle, setNewTitle] = useState('')

  useEffect(() => {
    setSubtasks(occurrence.subtasks)
  }, [occurrence.subtasks])

  const toggleMutation = useMutation({
    mutationFn: (subtaskId: string) => occurrencesApi.toggleSubtask(occurrence.id, subtaskId),
    onMutate: (subtaskId) => {
      setSubtasks((prev) => prev.map((s) => s.id === subtaskId ? { ...s, isDone: !s.isDone } : s))
    },
    onSuccess: (updated) => {
      setSubtasks(updated.subtasks)
      qc.invalidateQueries({ queryKey: ['events'] })
    },
    onError: (err, subtaskId) => {
      setSubtasks((prev) => prev.map((s) => s.id === subtaskId ? { ...s, isDone: !s.isDone } : s))
      toastError(err, 'Could not update subtask.')
    },
  })

  const createMutation = useMutation({
    mutationFn: (title: string) => occurrenceSubtasksApi.create(occurrence.id, { title }),
    onSuccess: (updated) => {
      setSubtasks(updated.subtasks)
      setNewTitle('')
      qc.invalidateQueries({ queryKey: ['events'] })
    },
    onError: (err) => toastError(err, 'Could not add subtask.'),
  })

  const deleteMutation = useMutation({
    mutationFn: (subtaskId: string) => occurrenceSubtasksApi.delete(occurrence.id, subtaskId),
    onMutate: (subtaskId) => {
      setSubtasks((prev) => prev.filter((s) => s.id !== subtaskId))
    },
    onSuccess: (updated) => {
      setSubtasks(updated.subtasks)
      qc.invalidateQueries({ queryKey: ['events'] })
    },
    onError: (err) => {
      setSubtasks(occurrence.subtasks)
      toastError(err, 'Could not delete subtask.')
    },
  })

  function handleAdd() {
    const title = newTitle.trim()
    if (!title) return
    createMutation.mutate(title)
  }

  const doneCount = subtasks.filter((s) => s.isDone).length

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Subtasks (${doneCount}/${subtasks.length})`}
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}
    >
      <div className="flex flex-col gap-3">
        {subtasks.length > 0 && (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {subtasks.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                <button
                  onClick={() => toggleMutation.mutate(s.id)}
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
                    s.isDone
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background hover:border-primary'
                  }`}
                >
                  {s.isDone && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                </button>
                <span className={`flex-1 text-sm ${s.isDone ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                  {s.title}
                </span>
                <button
                  onClick={() => deleteMutation.mutate(s.id)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
            placeholder="Add subtask..."
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={!newTitle.trim()}
            loading={createMutation.isPending}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </Modal>
  )
}
