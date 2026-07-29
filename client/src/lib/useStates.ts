import { useQuery } from '@tanstack/react-query'
import { statesApi } from './api'
import type { State, StateValue } from './types'

/**
 * The user's states with their values. Shares the `['states']` cache with the Settings editor, so a
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

/** Formats a duration in minutes the way the settings hint and the activity modal both want it. */
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

/** "Location: Work", for naming a value out of context. */
export function describeStateValue(states: State[], valueId: string): string | null {
  for (const state of states) {
    const value = state.values.find((v) => v.id === valueId)
    if (value) return `${state.name}: ${value.name}`
  }
  return null
}

/** Every value across every state, flattened, each still knowing which state it came from. */
export function flattenStateValues(states: State[]): { state: State; value: StateValue }[] {
  return states.flatMap((state) => state.values.map((value) => ({ state, value })))
}
