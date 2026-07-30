import { useState } from 'react'
import type { ActivityStateEffect, State } from '@/lib/types'
import {
  MAX_STATE_DURATION_MINUTES,
  STATE_DURATION_UNITS,
  splitStateDuration,
} from '@/lib/useStates'
import { inputCls } from '@/components/ui/input'
import { StateValuePicker } from './StateValuePicker'

const HOUR = 60

interface StateEffectPickerProps {
  states: State[]
  value: ActivityStateEffect[]
  onChange: (next: ActivityStateEffect[]) => void
}

/**
 * The "Changes" field: which state values doing this activity puts the world into, and how long each
 * one holds.
 *
 * The chips come from the shared {@link StateValuePicker}; the duration hangs off the end of the
 * same row, so a pick reads `Physical  [Fresh] [Tired]  for [10] [hours]` rather than being
 * restated in a list below the chips. The duration sits on the activity rather than on the value
 * because it describes the cause: a run leaves you tired for ten hours, a hike for two days.
 * Picking the state's *default* value gets no duration control - expiry means "fall back to the
 * default", so a default with an expiry would decay to itself, and the server rejects it.
 */
export function StateEffectPicker({ states, value, onChange }: StateEffectPickerProps) {
  // The unit is derived from the stored minutes, but a cleared number has no minutes to derive it
  // from. Remembering the choice per value stops the select snapping back to hours mid-edit and
  // reinterpreting the next number the user types.
  const [units, setUnits] = useState<Record<string, number>>({})

  const byId = new Map(value.map((e) => [e.stateValueId, e]))

  // Selecting through the shared picker is id-only, so durations are carried across by id and a newly
  // picked value starts with none.
  function onIdsChange(ids: string[]) {
    onChange(ids.map((id) => byId.get(id) ?? { stateValueId: id, durationMinutes: null }))
  }

  function setDuration(stateValueId: string, durationMinutes: number | null) {
    onChange(value.map((e) => (e.stateValueId === stateValueId ? { ...e, durationMinutes } : e)))
  }

  // `singlePerState` guarantees at most one pick per state, so the row never needs more than one.
  function duration(state: State) {
    const v = state.values.find((sv) => byId.has(sv.id))
    if (!v) return null
    if (v.isDefault) {
      return <span className="text-xs text-muted-foreground">defaults don't expire</span>
    }

    const minutes = byId.get(v.id)!.durationMinutes
    const split = minutes !== null ? splitStateDuration(minutes) : null
    const unitMinutes = units[v.id] ?? split?.unitMinutes ?? HOUR

    return (
      <span className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">for</span>
        <input
          type="number"
          min={1}
          max={Math.floor(MAX_STATE_DURATION_MINUTES / unitMinutes)}
          placeholder="--"
          aria-label={`How long ${state.name} stays ${v.name}`}
          value={split ? split.amount * (split.unitMinutes / unitMinutes) : ''}
          onChange={(e) => {
            const amount = Number(e.target.value)
            setDuration(v.id, e.target.value === '' || amount < 1 ? null : amount * unitMinutes)
          }}
          className={`${inputCls} w-12 text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
        />
        <select
          aria-label={`Unit for how long ${state.name} stays ${v.name}`}
          value={unitMinutes}
          onChange={(e) => {
            const next = Number(e.target.value)
            setUnits((prev) => ({ ...prev, [v.id]: next }))
            // Reinterpreting the number the user typed, not converting it: switching hours
            // to days after typing 2 means 2 days, not 0.08 of one.
            if (split) setDuration(v.id, split.amount * (split.unitMinutes / unitMinutes) * next)
          }}
          className={`${inputCls} shrink-0 pr-1`}
        >
          {STATE_DURATION_UNITS.map((u) => (
            <option key={u.minutes} value={u.minutes}>{u.label}</option>
          ))}
        </select>
      </span>
    )
  }

  const anyBlank = states.some((s) =>
    s.values.some((v) => !v.isDefault && byId.get(v.id)?.durationMinutes === null),
  )

  return (
    <div className="flex flex-col gap-1.5">
      <StateValuePicker
        states={states}
        value={[...byId.keys()]}
        onChange={onIdsChange}
        singlePerState
        trailing={duration}
      />

      {anyBlank && (
        <p className="text-xs text-muted-foreground">
          Leave the time blank and the value holds until something else changes it.
        </p>
      )}
    </div>
  )
}
