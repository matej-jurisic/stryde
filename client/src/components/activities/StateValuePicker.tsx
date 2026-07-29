import type { State } from '@/lib/types'
import { formatStateDuration } from '@/lib/useStates'

interface StateValuePickerProps {
  states: State[]
  /** Selected value ids, across every state. */
  value: string[]
  onChange: (next: string[]) => void
  /**
   * True for the "changes" field: picking a value replaces whatever was chosen for that same state,
   * because an activity cannot put one state into two values at once. False lets a state accept
   * several, which is what a requirement means.
   */
  singlePerState?: boolean
  /** Shown when the value carries an expiry, so the effect of picking it is visible up front. */
  showDurations?: boolean
}

/**
 * Chips grouped by state. Built on the same shape as the activity type chip row rather than a
 * multi-select, because the whole set has to be visible at a glance to be checkable.
 */
export function StateValuePicker({
  states,
  value,
  onChange,
  singlePerState = false,
  showDurations = false,
}: StateValuePickerProps) {
  const selected = new Set(value)

  function toggle(state: State, valueId: string) {
    const next = new Set(selected)
    if (next.has(valueId)) {
      next.delete(valueId)
    } else {
      if (singlePerState) for (const v of state.values) next.delete(v.id)
      next.add(valueId)
    }
    onChange([...next])
  }

  return (
    <div className="flex flex-col gap-2">
      {states.filter((s) => s.values.length > 0).map((state) => (
        <div key={state.id} className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{state.name}</span>
          <div className="flex flex-wrap gap-1.5">
            {state.values.map((v) => {
              const isSelected = selected.has(v.id)
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => toggle(state, v.id)}
                  aria-pressed={isSelected}
                  className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                    isSelected
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-input text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {v.name}
                  {showDurations && v.durationMinutes !== null && (
                    <span className="text-[10px] font-normal opacity-70">
                      {formatStateDuration(v.durationMinutes)}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
