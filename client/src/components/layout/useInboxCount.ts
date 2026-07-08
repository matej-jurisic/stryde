import { useQuery } from '@tanstack/react-query'
import { eventsApi } from '@/lib/api'

// Shares the ['events', 'all'] cache with InboxPage so event writes refresh the badge too.
export function useInboxCount() {
  const { data = [] } = useQuery({
    queryKey: ['events', 'all'],
    queryFn: () => eventsApi.list(),
    staleTime: 30_000,
  })
  return data.filter((e) => e.status === 'pending' && !e.startAt && !e.category).length
}
