import type { Occurrence } from './types'

// Membership rule for the default "No category" view on the Categories page.
// The nav badge counts the pending subset of exactly this, so keep the two in
// sync by sharing the predicate.
export function isUncategorized(o: Occurrence): boolean {
  return !o.activity.category
}
