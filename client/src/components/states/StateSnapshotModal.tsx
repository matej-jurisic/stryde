import { useQuery } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { statesApi } from '@/lib/api'
import type { StateSnapshotEntry } from '@/lib/types'

/**
 * What the world looks like at one instant, opened by clicking empty space on the calendar grid.
 *
 * Read-only on purpose: a state's value is derived from the schedule, so there is nothing here to
 * edit. Anything wrong in it is wrong on the calendar or in an activity's "Changes", and the fix
 * belongs there. See `spec.md` -> States.
 */
export function StateSnapshotModal({
  open,
  at,
  onClose,
}: {
  open: boolean
  /** The instant asked about, as a local Date. Null keeps the modal closed. */
  at: Date | null
  onClose: () => void
}) {
  const iso = at ? at.toISOString() : null

  const { data, isLoading, isError } = useQuery({
    queryKey: ['states', 'snapshot', iso],
    queryFn: () => statesApi.snapshot(iso!),
    enabled: open && iso !== null,
    // The answer depends on every occurrence around it, so a second look after moving something has
    // to re-ask rather than repeat the reading that prompted the move.
    staleTime: 0,
  })

  return (
    <Modal open={open} onClose={onClose} title={at ? `States at ${formatInstant(at)}` : 'States'}>
      {isLoading && <p className="text-sm text-muted-foreground">Reading the schedule...</p>}
      {isError && <p className="text-sm text-destructive">Could not read the states for that moment.</p>}
      {data && data.states.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No states yet. Define one under Activities - States to track where you are or how you feel.
        </p>
      )}
      {data && data.states.length > 0 && (
        <div className="divide-y divide-border rounded-lg border border-border bg-muted/40">
          {data.states.map((entry) => (
            <StateRow key={entry.stateId} entry={entry} at={at!} />
          ))}
        </div>
      )}
    </Modal>
  )
}

/** State name in a fixed left column, its value and the reason for it in the rest of the width. */
function StateRow({ entry, at }: { entry: StateSnapshotEntry; at: Date }) {
  return (
    <div className="flex gap-3 px-3 py-2.5">
      <span className="w-20 shrink-0 truncate pt-0.5 text-xs text-muted-foreground" title={entry.stateName}>
        {entry.stateName}
      </span>
      <div className="min-w-0 flex-1">
        {entry.valueName ? (
          <span className="inline-flex h-6 items-center rounded-lg border border-primary bg-primary/10 px-2 text-xs font-medium text-foreground">
            {entry.valueName}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">No value - this state has no default yet</span>
        )}
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{describe(entry, at)}</p>
      </div>
    </div>
  )
}

/**
 * The "why" line. Says where the value came from and how long it lasts, in that order, and leaves out
 * the half it cannot know: an untouched default has no cause, and an indefinite value has no end.
 */
function describe(entry: StateSnapshotEntry, at: Date): string {
  if (!entry.valueName) return 'Nothing has set it, and it has no default to fall back to.'

  const time = (iso: string) => formatRelative(iso, at)

  const parts: string[] = []
  if (entry.since === null) parts.push('Default, nothing has set it')
  else if (entry.setBy) parts.push(`Set by ${entry.setBy} at ${time(entry.since)}`)
  else if (entry.isDefault) parts.push(`Back to default since ${time(entry.since)}`)
  else parts.push(`In force since ${time(entry.since)}`)

  if (entry.until !== null) {
    parts.push(entry.nextValueName
      ? `until ${time(entry.until)}, then ${entry.nextValueName}`
      : `until ${time(entry.until)}`)
  } else if (entry.since !== null && !entry.isDefault) {
    parts.push('holds until something changes it')
  }

  return parts.join(', ') + '.'
}

/** "Thu 30 Jul, 14:15" - the moment the dialog is about, so the title alone identifies it. */
function formatInstant(d: Date): string {
  const date = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  return `${date}, ${hhmm(d)}`
}

/**
 * A cause or an expiry, dated only when it falls on a different day than the moment being described -
 * "at 08:30" for this morning's commute, "at Tue 28 Jul, 09:00" for a two-day tiredness still running.
 */
function formatRelative(iso: string, ref: Date): string {
  const d = new Date(iso)
  const sameDay =
    d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate()
  return sameDay ? hhmm(d) : formatInstant(d)
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
