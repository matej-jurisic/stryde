export interface User {
  id: string
  username: string
  timezone: string
}

export interface AuthResponse {
  accessToken: string
  user: User
}

export type EventStatus = 'pending' | 'done' | 'skipped'
export type GoalStatus = 'focus' | 'active' | 'bench' | 'closed'
export type CheckpointStatus = 'pending' | 'reached'
export type CheckpointSize = 'tiny' | 'small' | 'normal' | 'big' | 'huge'

export interface GoalSummary {
  id: string
  title: string
  status: GoalStatus
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

export interface Goal {
  id: string
  userId: string
  title: string
  description: string | null
  status: GoalStatus
  createdAt: string
  checkpoints: Checkpoint[]
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

export interface Event {
  id: string
  userId: string
  title: string
  startAt: string | null
  endAt: string | null
  status: EventStatus
  isAllDay: boolean
  windowStart: string | null
  windowEnd: string | null
  windowDurationMinutes: number | null
  repeatRuleId: string | null
  createdAt: string
  isOverdue: boolean
  goals: GoalSummary[]
  category: CategorySummary | null
}

export interface BaseEventSummary {
  id: string
  title: string
  category: CategorySummary | null
  goals: GoalSummary[]
}

export type Recommendation =
  | { tier: number; type: 'event'; event: Event; baseEvent: null }
  | { tier: number; type: 'base_event'; event: null; baseEvent: BaseEventSummary }

export interface UserSettings {
  userId: string
  maxFocusGoals: number
  dayBoundaryTime: string // "HH:mm"
  timezone: string // IANA id
}
