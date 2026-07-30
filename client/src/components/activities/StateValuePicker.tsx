import type { ReactNode } from 'react'
import type { State } from '@/lib/types'

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
  /**
   * Rendered inline after a state's chips, sharing their wrapping row. The effect picker hangs
   * `for [10] [hours]` here so the duration reads as the end of the same sentence instead of
   * restating the pick in a list underneath.
   */
  trailing?: (state: State) => ReactNode
}

/**
 * Chips grouped by state, one row per state: the name sits in a fixed left column so the chip
 * groups line up down the field, and the row reads `Physical  [Fresh] [Tired]`. Built on chips
 * rather than a multi-select because the whole set has to be visible at a glance to be checkable.
 */
export function StateValuePicker({
  states,
  value,
  onChange,
  singlePerState = false,
  trailing,
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
    <div className="flex flex-col gap-1.5">
      {states.filter((s) => s.values.length > 0).map((state) => (
        <div key={state.id} className="flex gap-2">
          <span
            className="flex h-8 w-20 shrink-0 items-center truncate text-xs text-muted-foreground"
            title={state.name}
          >
            {state.name}
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
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
                </button>
              )
            })}
            {trailing?.(state)}
          </div>
        </div>
      ))}
    </div>
  )
}
