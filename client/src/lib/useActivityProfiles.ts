import { useQuery } from '@tanstack/react-query'
import { activityProfilesApi } from './api'
import type { ActivityProfile, ActivityType } from './types'

/**
 * The user's resolved activity type profiles, keyed by type. Shares the `['activityProfiles']`
 * cache with the Settings editor, so hint copy anywhere reflects an edit as soon as it lands.
 * Undefined while loading: callers fall back to the non-numeric blurb.
 */
export function useActivityProfiles(): Map<ActivityType, ActivityProfile> | undefined {
  const { data } = useQuery({
    queryKey: ['activityProfiles'],
    queryFn: activityProfilesApi.list,
    staleTime: 5 * 60 * 1000,
  })
  if (!data) return undefined
  return new Map(data.map((p) => [p.type, p]))
}
