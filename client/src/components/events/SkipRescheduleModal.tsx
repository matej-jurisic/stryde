import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { occurrencesApi } from '@/lib/api'
import type { Occurrence } from '@/lib/types'

function formatDateInput(d: Date): string {
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}

function defaultDate(occurrence: Occurrence): string {
  const ref = occurrence.startAt ?? occurrence.endAt
  const base = ref ? new Date(ref) : new Date()
  base.setDate(base.getDate() + 1)
  return formatDateInput(base)
}

function shiftToDate(iso: string, newDateStr: string): string {
  const d = new Date(iso)
  const target = new Date(newDateStr + 'T00:00:00')
  d.setFullYear(target.getFullYear(), target.getMonth(), target.getDate())
  return d.toISOString()
}

interface SkipRescheduleModalProps {
  open: boolean
  onClose: () => void
  occurrence: Occurrence | null
  onDone: () => void
}

export function SkipRescheduleModal({ open, onClose, occurrence, onDone }: SkipRescheduleModalProps) {
  const qc = useQueryClient()
  const [date, setDate] = useState('')

  useEffect(() => {
    if (occurrence) setDate(defaultDate(occurrence))
  }, [occurrence])

  const mutation = useMutation({
    mutationFn: async (reschedule: boolean) => {
      await occurrencesApi.setStatus(occurrence!.id, 'skipped')
      if (reschedule && date) {
        const o = occurrence!
        await occurrencesApi.create({
          activityId: o.activityId,
          title: o.title,
          startAt: o.startAt ? shiftToDate(o.startAt, date) : null,
          endAt: o.endAt ? shiftToDate(o.endAt, date) : null,
          isAllDay: o.isAllDay,
          isPlanned: o.isPlanned,
          durationMinutes: o.durationMinutes,
        })
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
      onDone()
    },
  })

  if (!occurrence) return null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Skip occurrence"
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => mutation.mutate(false)}
            loading={mutation.isPending && mutation.variables === false}
            disabled={mutation.isPending}
          >
            Skip only
          </Button>
          <Button
            onClick={() => mutation.mutate(true)}
            loading={mutation.isPending && mutation.variables === true}
            disabled={mutation.isPending || !date}
          >
            Skip & reschedule
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        Reschedule a copy to another day, or skip without rescheduling.
      </p>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Reschedule to</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault() }}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
    </Modal>
  )
}
