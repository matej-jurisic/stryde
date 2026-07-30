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

/**
 * A user-authored scheduling preset: when the engine may place an activity of this type, and how
 * often it should come round. An activity with no type is unconstrained.
 */
export interface ActivityType {
  id: string
  userId: string
  name: string
  /** Lucide component name, resolved through the client's icon map. */
  icon: string | null
  windowStart: string // "HH:mm"
  windowEnd: string // "HH:mm"
  minBlockMinutes: number
  /** 0 = unlimited. */
  maxPerDay: number
  cadencePriorDays: number
  /** 0 = no cooldown. Fraction of the activity's own rhythm. */
  minDueFraction: number
  createdAt: string
}

export interface ActivityTypeSummary {
  id: string
  name: string
  icon: string | null
}

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
  /** Null means no type, which is the unconstrained scheduling profile. */
  activityTypeId: string | null
  excludeFromRecommendations: boolean
  createdAt: string
  category: CategorySummary | null
  goal: GoalSummary | null
  type: ActivityTypeSummary | null
  subtasks: ActivitySubtask[]
  /** State values this activity puts the world into, and for how long. At most one per state. */
  setsStateValues: ActivityStateEffect[]
  /** Only suggested while every state named here holds one of its listed values. */
  requiredStateValueIds: string[]
}

/** One state change an activity causes. */
export interface ActivityStateEffect {
  stateValueId: string
  /**
   * Minutes the value holds before falling back to the state's default, or null for "until something
   * else changes it". Lives here rather than on the value because it describes the cause: the same
   * "Tired: Yes" lasts ten hours after a run and two days after a hike.
   */
  durationMinutes: number | null
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

/** An activity to schedule, plus the raw "why" signals the panel composes its reason text from. */
export interface Recommendation {
  tier: number
  activity: Activity
  typicalDurationMinutes: number | null
  typicalStartTime: string | null
  daysSinceLast: number | null
  medianGapDays: number | null
  patternCount: number | null
  /**
   * Best free slot on the target day. Null when nothing fits, when the day is past, or when the
   * activity's habitual time is taken and every opening is too far from it.
   */
  suggestedStartAt: string | null
}

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

// Calendar overlay: minutes from local midnight; weekday 0 = Sunday (matches Date.getDay)
export interface InsightsFreeRange {
  weekday: number
  startMinute: number
  endMinute: number
}

export interface InsightsEmptyProfile {
  ranges: InsightsFreeRange[]
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
  /** Suggestion ghosts drawn per day on the calendar. */
  maxCalendarSuggestions: number
}

/**
 * A user-defined dimension of context the engine gates suggestions on: Location, Tired. Its value at
 * any moment is derived from the schedule rather than stored, so moving an occurrence moves the state
 * with it.
 */
export interface State {
  id: string
  userId: string
  name: string
  createdAt: string
  /** In creation order. Exactly one is the default once the state has any values at all. */
  values: StateValue[]
}

export interface StateValue {
  id: string
  stateId: string
  name: string
  /** In force before anything sets the state, and what an expiring value falls back to. */
  isDefault: boolean
  createdAt: string
}
