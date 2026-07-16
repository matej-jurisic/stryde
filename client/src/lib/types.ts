export interface User {
  id: string
  username: string
  timezone: string
}

export interface AuthResponse {
  accessToken: string
  user: User
  refreshToken?: string
}

export type EventStatus = 'pending' | 'done' | 'skipped'
export type GoalStatus = 'focus' | 'active' | 'bench' | 'closed'
export type GoalKind = 'milestone' | 'ongoing'
export type CheckpointStatus = 'pending' | 'reached'
export type CheckpointSize = 'tiny' | 'small' | 'normal' | 'big' | 'huge'
export type ActivityKind = 'activity' | 'event'

export interface GoalSummary {
  id: string
  title: string
  status: GoalStatus
  kind: GoalKind
}

export interface Checkpoint {
  id: string
  goalId: string
  title: string
  size: CheckpointSize
  targetDate: string | null
  status: CheckpointStatus
  createdAt: string
}

export interface GoalOccurrenceStats {
  done: number
  skipped: number
  pending: number
}

export interface Goal {
  id: string
  userId: string
  title: string
  description: string | null
  notes: string | null
  status: GoalStatus
  kind: GoalKind
  createdAt: string
  checkpoints: Checkpoint[]
  occurrenceStats: GoalOccurrenceStats | null
  lastOccurrenceAt: string | null
}

export interface CategorySummary {
  id: string
  name: string
  color: string
  icon: string | null
}

export interface Category {
  id: string
  userId: string
  name: string
  color: string
  icon: string | null
  createdAt: string
}

export interface ActivitySubtask {
  id: string
  activityId: string
  title: string
  createdAt: string
}

export interface OccurrenceSubtask {
  id: string
  occurrenceId: string
  title: string
  isDone: boolean
  createdAt: string
}

export interface Activity {
  id: string
  userId: string
  title: string
  categoryId: string | null
  goalId: string | null
  kind: ActivityKind
  createdAt: string
  category: CategorySummary | null
  goal: GoalSummary | null
  subtasks: ActivitySubtask[]
}

export interface Occurrence {
  id: string
  userId: string
  activityId: string
  title: string | null
  effectiveTitle: string
  startAt: string | null
  endAt: string | null
  status: EventStatus
  isAllDay: boolean
  isPlanned: boolean
  durationMinutes: number | null
  createdAt: string
  isOverdue: boolean
  subtasks: OccurrenceSubtask[]
  activity: Activity
}

export type Recommendation =
  | { tier: number; type: 'occurrence'; occurrence: Occurrence; activity: null; typicalDurationMinutes: number | null; typicalStartTime: string | null }
  | { tier: number; type: 'activity'; occurrence: null; activity: Activity; typicalDurationMinutes: number | null; typicalStartTime: string | null }

export interface InsightsActivity {
  activityId: string
  title: string
  categoryColor: string | null
  timeMinutes: number
  count: number
}

export interface InsightsCategory {
  categoryId: string | null
  name: string | null
  color: string | null
  icon: string | null
  done: number
  timeMinutes: number
}

export interface InsightsGap {
  day: string
  start: string
  end: string
  minutes: number
}

export interface InsightsUnusedBlock {
  start: string
  end: string
  emptyDays: number
  days: number
}

export interface Insights {
  activities: InsightsActivity[]
  categories: InsightsCategory[]
  avgUnaccountedMinutesPerDay: number | null
  prevAvgUnaccountedMinutesPerDay: number | null
  largestGaps: InsightsGap[]
  unusedBlocks: InsightsUnusedBlock[]
}

export interface UserSettings {
  userId: string
  maxFocusGoals: number
  dayBoundaryTime: string // "HH:mm"
  timezone: string // IANA id
}
