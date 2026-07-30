import type { ActivityType } from './types'

/**
 * What "no type" means, in the same words the picker uses for a real one. Null is the unconstrained
 * profile, not a missing value, so it gets a label rather than an empty slot.
 */
export const NO_TYPE_LABEL = 'No type'
export const NO_TYPE_HINT = 'No scheduling constraints.'

/** Normalises a "H:m" window bound to 24h "HH:mm". */
export function formatWindowTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function formatDays(days: number): string {
  return days % 1 === 0 ? String(days) : days.toFixed(1)
}

/**
 * The cadence values the editor can express, and the only ones anything should be seeded at: a
 * number the dropdown cannot reproduce would make a type unreachable by hand, which is the whole
 * thing user-owned types exist to avoid.
 */
export const CADENCE_OPTIONS = [
  { value: 1, label: 'Daily' },
  { value: 2.5, label: 'Every few days' },
  { value: 7, label: 'Weekly' },
  { value: 14, label: 'Every couple of weeks' },
]

export const COOLDOWN_OPTIONS = [
  { value: 0, label: "As soon as it's due" },
  { value: 0.5, label: "Once you're halfway to due" },
  { value: 1, label: 'Only when fully due' },
]

/** Just the scheduling numbers, so an unsaved edit can be described the same way a saved row is. */
export type ProfileFields = Pick<
  ActivityType,
  'windowStart' | 'windowEnd' | 'minBlockMinutes' | 'maxPerDay' | 'cadencePriorDays' | 'minDueFraction'
>

/**
 * Plain-language description of what a type does to the engine, generated from the row rather than
 * hardcoded: every number here is the user's own.
 */
export function describeProfile(t: ProfileFields): { placement: string; rhythm: string } {
  const parts = [`Placed ${formatWindowTime(t.windowStart)} to ${formatWindowTime(t.windowEnd)}`]
  if (t.minBlockMinutes > 0) parts.push(`needs ${t.minBlockMinutes} free minutes`)
  if (t.maxPerDay > 0) parts.push(`max ${t.maxPerDay} a day`)

  const cadence =
    t.cadencePriorDays === 1 ? 'Daily' : `About every ${formatDays(t.cadencePriorDays)} days`

  const cooldown =
    t.minDueFraction > 0
      ? t.minDueFraction === 0.5
        ? ', once halfway to due'
        : `, once ${Math.round(t.minDueFraction * 100)}% to due`
      : ''

  return { placement: `${parts.join(', ')}.`, rhythm: `${cadence}${cooldown}.` }
}

/** One-line form, for the type picker. */
export function profileHint(type: ActivityType | undefined): string {
  if (!type) return NO_TYPE_HINT
  const { placement, rhythm } = describeProfile(type)
  return `${placement} ${rhythm}`
}
