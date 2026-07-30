import { useQuery } from '@tanstack/react-query'
import { statesApi } from './api'
import type { State } from './types'

/**
 * The user's states with their values. Shares the `['states']` cache with the States tab, so a
 * value renamed there shows up in the activity modal without a refetch.
 */
export function useStates() {
  const { data, isLoading } = useQuery({
    queryKey: ['states'],
    queryFn: statesApi.list,
    staleTime: 5 * 60 * 1000,
  })
  return { states: data ?? [], isLoading }
}

/** Thirty days, matching Validators.MaxStateDurationMinutes. */
export const MAX_STATE_DURATION_MINUTES = 43200

/**
 * The units a state effect's duration can be entered in. Minutes are what the API stores; the unit
 * exists because the values people actually want are "10 hours" and "2 days", and typing 2880 into a
 * minutes box is a small arithmetic exam.
 */
export const STATE_DURATION_UNITS = [
  { label: 'minutes', minutes: 1 },
  { label: 'hours', minutes: 60 },
  { label: 'days', minutes: 1440 },
] as const

/** Splits stored minutes into the largest unit that divides them evenly, for editing. */
export function splitStateDuration(minutes: number): { amount: number; unitMinutes: number } {
  for (const unit of [...STATE_DURATION_UNITS].reverse()) {
    if (minutes % unit.minutes === 0) return { amount: minutes / unit.minutes, unitMinutes: unit.minutes }
  }
  return { amount: minutes, unitMinutes: 1 }
}

/** Formats a duration in minutes the way the activity modal and its hints want it. */
export function formatStateDuration(minutes: number): string {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440
    return days === 1 ? '1 day' : `${days} days`
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return hours === 1 ? '1 hour' : `${hours} hours`
  }
  return `${minutes} min`
}

/**
 * Names a whole requirement set the way the engine reads it: "Location: Home or Work, Tired: No" -
 * ORed within a state, ANDed across them. States are walked in their own order so the same set always
 * produces the same string, which is what lets it key a group. Unknown ids are skipped.
 */
export function describeRequirements(states: State[], valueIds: string[]): string {
  const parts: string[] = []
  for (const state of states) {
    const names = state.values.filter((v) => valueIds.includes(v.id)).map((v) => v.name)
    if (names.length > 0) parts.push(`${state.name}: ${names.join(' or ')}`)
  }
  return parts.join(', ')
}

/** "Location: Work", for naming a value out of context. */
export function describeStateValue(states: State[], valueId: string): string | null {
  for (const state of states) {
    const value = state.values.find((v) => v.id === valueId)
    if (value) return `${state.name}: ${value.name}`
  }
  return null
}
