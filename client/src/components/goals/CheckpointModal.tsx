import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { checkpointsApi, ApiError } from '@/lib/api'
import type { Checkpoint, CheckpointSize } from '@/lib/types'

const SIZES: { value: CheckpointSize; label: string }[] = [
  { value: 'tiny',   label: 'Tiny'   },
  { value: 'small',  label: 'Small'  },
  { value: 'normal', label: 'Normal' },
  { value: 'big',    label: 'Big'    },
  { value: 'huge',   label: 'Huge'   },
]

interface FormState {
  title: string
  size: CheckpointSize
  targetDate: string
}

interface Errors {
  title?: string
}

function validate(form: FormState): Errors {
  const errs: Errors = {}
  if (!form.title.trim()) errs.title = 'Title is required.'
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

  const [form, setForm] = useState<FormState>({ title: '', size: 'normal', targetDate: '' })
  const [errors, setErrors] = useState<Errors>({})
  const [apiError, setApiError] = useState('')

  useEffect(() => {
    if (open) {
      setForm({
        title: checkpoint?.title ?? '',
        size: checkpoint?.size ?? 'normal',
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
        size: form.size,
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
        placeholder="e.g. Learn your first full song"
        error={errors.title}
        autoFocus
      />

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-foreground">Size</span>
        <div className="grid grid-cols-5 gap-1">
          {SIZES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setForm((f) => ({ ...f, size: value }))}
              className={`rounded-md border py-1.5 text-xs font-medium transition-colors ${
                form.size === value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-muted-foreground hover:border-primary hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

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
