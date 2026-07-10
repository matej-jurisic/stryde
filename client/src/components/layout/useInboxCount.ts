import { useQuery } from '@tanstack/react-query'
import { occurrencesApi } from '@/lib/api'

// Shares the ['events', 'all'] cache with InboxPage so occurrence writes refresh the badge too.
export function useInboxCount() {
  const { data = [] } = useQuery({
    queryKey: ['events', 'all'],
    queryFn: () => occurrencesApi.list(),
    staleTime: 30_000,
  })
  return data.filter((o) => o.status === 'pending' && !o.startAt && !o.activity.category).length
}
