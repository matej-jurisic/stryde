import { useQuery } from '@tanstack/react-query'
import { activityTypesApi } from './api'
import type { ActivityType } from './types'

/**
 * The user's activity types in creation order. Shares the `['activityTypes']` cache with the
 * Types tab, so hint copy anywhere reflects an edit as soon as it lands. Undefined while
 * loading, which callers treat as "no type information yet" rather than "no types".
 */
export function useActivityTypes(): ActivityType[] | undefined {
  const { data } = useQuery({
    queryKey: ['activityTypes'],
    queryFn: activityTypesApi.list,
    staleTime: 5 * 60 * 1000,
  })
  return data
}

/** The same list keyed by id, for resolving an activity's `activityTypeId`. */
export function useActivityTypeMap(): Map<string, ActivityType> | undefined {
  const types = useActivityTypes()
  if (!types) return undefined
  return new Map(types.map((t) => [t.id, t]))
}
