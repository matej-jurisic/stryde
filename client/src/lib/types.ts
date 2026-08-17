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
  /**
   * Chained mode only: the other suggestions this one needs first, by title. Null means it stands on
   * its own - which is the difference between a slot you can take now and one that is conditional.
   */
  unlockedBy: string[] | null
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
  /**
   * State values that make time count towards the unaccounted-time stats: ORed within a state, ANDed
   * across states, exactly like an activity's requirements. Empty means the whole day counts.
   */
  unaccountedStateValueIds: string[]
  /** Master switch for the assistant. Off, nothing calls out to a model at all. */
  llmEnabled: boolean
  /** Root of the Ollama server, e.g. "http://ollama:11434". */
  llmBaseUrl: string | null
  llmModel: string | null
  llmTimeoutSeconds: number
  /** Ask reasoning models not to think. Rejected outright by models that have no thinking mode. */
  llmNoThink: boolean
}

/** What one model call cost, shown rather than logged: a local call is slow enough to need saying. */
export interface CaptureDiagnostics {
  model: string
  totalMs: number
  loadMs: number
  promptTokens: number
  outputTokens: number
  rawJson: string
}

/**
 * A filled-in occurrence form the assistant proposes. Nothing is saved server-side: this is handed to
 * the normal editor, and the user creates it there. `activityId` null means the note matched no
 * existing activity, so it opens as a new event.
 */
export interface CaptureDraft {
  title: string
  activityId: string | null
  activityTitle: string | null
  startAt: string | null
  endAt: string | null
  isAllDay: boolean
  durationMinutes: number | null
  subtasks: string[]
  diagnostics: CaptureDiagnostics
}

export interface LlmStatus {
  model: string
  modelAvailable: boolean
  availableModels: string[]
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

/**
 * What every state held at one instant. Derived from the schedule server-side, so it answers for a
 * future instant as readily as a past one, and moving an occurrence moves the reading with it.
 */
export interface StateSnapshot {
  at: string
  states: StateSnapshotEntry[]
}

export interface StateSnapshotEntry {
  stateId: string
  stateName: string
  /** Null when the state has no default and nothing has set it. */
  valueId: string | null
  valueName: string | null
  /** The value in force is the state's default, i.e. nothing is holding it. */
  isDefault: boolean
  /** When the value took effect; null while nothing has ever set the state. */
  since: string | null
  /** When it changes next, by expiry or by another setter; null holds indefinitely. */
  until: string | null
  setByOccurrenceId: string | null
  /** Title of the occurrence that set it; null for an untouched default or a value it decayed back to. */
  setBy: string | null
  nextValueName: string | null
}

export interface StateValue {
  id: string
  stateId: string
  name: string
  /** In force before anything sets the state, and what an expiring value falls back to. */
  isDefault: boolean
  createdAt: string
}
