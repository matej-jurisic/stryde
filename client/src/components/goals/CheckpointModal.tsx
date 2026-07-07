import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { checkpointsApi, ApiError } from '@/lib/api'
import type { Checkpoint } from '@/lib/types'

interface FormState {
  title: string
  plannedProgress: string
  targetDate: string
}

interface Errors {
  title?: string
  plannedProgress?: string
}

function validate(form: FormState): Errors {
  const errs: Errors = {}
  if (!form.title.trim()) errs.title = 'Title is required.'
  const p = Number(form.plannedProgress)
  if (isNaN(p) || p < 0 || p > 100) errs.plannedProgress = 'Must be between 0 and 100.'
  return errs
}

interface CheckpointModalProps {
  open: boolean
  onClose: () => void
  goalId: string
  checkpoint?: Checkpoint
}

export function CheckpointModal({ open, onClose, goalId, checkpoint }: CheckpointModalProps) {
  const qc = useQueryClient()
  const isEdit = Boolean(checkpoint)

  const [form, setForm] = useState<FormState>({ title: '', plannedProgress: '0', targetDate: '' })
  const [errors, setErrors] = useState<Errors>({})
  const [apiError, setApiError] = useState('')

  useEffect(() => {
    if (open) {
      setForm({
        title: checkpoint?.title ?? '',
        plannedProgress: checkpoint ? String(checkpoint.plannedProgress) : '0',
        targetDate: checkpoint?.targetDate ? checkpoint.targetDate.slice(0, 10) : '',
      })
      setErrors({})
      setApiError('')
    }
  }, [open, checkpoint])

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        title: form.title.trim(),
        plannedProgress: Number(form.plannedProgress),
        targetDate: form.targetDate ? new Date(form.targetDate).toISOString() : null,
      }
      return isEdit
        ? checkpointsApi.update(goalId, checkpoint!.id, payload)
        : checkpointsApi.create(goalId, payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goals'] })
      onClose()
    },
    onError: (err) => {
      setApiError(err instanceof ApiError ? err.message : 'Something went wrong.')
    },
  })

  function handleSubmit() {
    const errs = validate(form)
    if (Object.keys(errs).length > 0) { setErrors(errs); return }
    setApiError('')
    mutation.mutate()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Checkpoint' : 'Add Checkpoint'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button onClick={handleSubmit} loading={mutation.isPending}>
            {isEdit ? 'Save Changes' : 'Add Checkpoint'}
          </Button>
        </>
      }
    >
      <Field
        label="Title"
        value={form.title}
        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        placeholder="e.g. Reach 20km long run"
        error={errors.title}
        autoFocus
      />
      <Field
        label="Planned progress (%)"
        type="number"
        min={0}
        max={100}
        value={form.plannedProgress}
        onChange={(e) => setForm((f) => ({ ...f, plannedProgress: e.target.value }))}
        placeholder="0"
        error={errors.plannedProgress}
      />
      <Field
        label="Target date (optional)"
        type="date"
        value={form.targetDate}
        onChange={(e) => setForm((f) => ({ ...f, targetDate: e.target.value }))}
      />
      {apiError && <p className="text-sm text-destructive">{apiError}</p>}
    </Modal>
  )
}
