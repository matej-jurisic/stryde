import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { goalsApi, ApiError } from '@/lib/api'
import type { Goal } from '@/lib/types'

interface FormState {
  title: string
  description: string
}

interface Errors {
  title?: string
}

function validate(form: FormState): Errors {
  const errs: Errors = {}
  if (!form.title.trim()) errs.title = 'Title is required.'
  if (form.title.length > 255) errs.title = 'Title cannot exceed 255 characters.'
  return errs
}

interface GoalModalProps {
  open: boolean
  onClose: () => void
  goal?: Goal
}

export function GoalModal({ open, onClose, goal }: GoalModalProps) {
  const qc = useQueryClient()
  const isEdit = Boolean(goal)

  const [form, setForm] = useState<FormState>({ title: '', description: '' })
  const [errors, setErrors] = useState<Errors>({})
  const [apiError, setApiError] = useState('')

  useEffect(() => {
    if (open) {
      setForm({ title: goal?.title ?? '', description: goal?.description ?? '' })
      setErrors({})
      setApiError('')
    }
  }, [open, goal])

  const mutation = useMutation({
    mutationFn: () => {
      const payload = { title: form.title.trim(), description: form.description.trim() || null }
      return isEdit ? goalsApi.update(goal!.id, payload) : goalsApi.create(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goals'] })
      // Goal titles appear on event badges and recommendations
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
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
      title={isEdit ? 'Edit Goal' : 'New Goal'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button onClick={handleSubmit} loading={mutation.isPending}>
            {isEdit ? 'Save Changes' : 'Create Goal'}
          </Button>
        </>
      }
    >
      <Field
        label="Title"
        value={form.title}
        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        placeholder="What are you working towards?"
        error={errors.title}
        autoFocus
      />
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground">Description</label>
        <textarea
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Optional — describe the goal and what success looks like."
          rows={3}
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
      </div>
      {apiError && <p className="text-sm text-destructive">{apiError}</p>}
    </Modal>
  )
}
