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

export interface GoalSummary {
  id: string
  title: string
  status: GoalStatus
}

export interface Checkpoint {
  id: string
  goalId: string
  title: string
  plannedProgress: number
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

export interface Event {
  id: string
  userId: string
  title: string
  startAt: string | null
  endAt: string | null
  status: EventStatus
  repeatRuleId: string | null
  createdAt: string
  isOverdue: boolean
  goals: GoalSummary[]
}

export interface Recommendation {
  tier: number
  event: Event
}

export interface UserSettings {
  userId: string
  maxFocusGoals: number
  dayBoundaryTime: string // "HH:mm"
  timezone: string // IANA id
}
