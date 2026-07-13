import { useQuery } from '@tanstack/react-query'
import { occurrencesApi } from '@/lib/api'
import { isUncategorized } from '@/lib/categories'

// Shares the ['events', 'all'] cache with CategoriesPage so occurrence writes refresh the badge too.
// Counts the pending rows of the "No category" view (everything above the
// Completed / Skipped group), using the same membership predicate as the page.
export function useUncategorizedCount() {
  const { data = [] } = useQuery({
    queryKey: ['events', 'all'],
    queryFn: () => occurrencesApi.list(),
    staleTime: 30_000,
  })
  return data.filter((o) => o.status === 'pending' && isUncategorized(o)).length
}
