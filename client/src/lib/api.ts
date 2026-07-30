import { useAuthStore } from '@/store/auth'
import { getServerUrl, isNative, getNativeRefreshToken, setNativeRefreshToken } from './server-config'
import type { AuthResponse, User, Goal, GoalStatus, GoalKind, Checkpoint, CheckpointStatus, UserSettings, Recommendation, Category, Activity, ActivityStateEffect, ActivityType, ActivitySubtask, Occurrence, Insights, InsightsEmptyProfile, State, StateSnapshot } from './types'

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

let refreshPromise: Promise<boolean> | null = null

export async function tryRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    try {
      const headers: Record<string, string> = {}
      if (isNative()) {
        const stored = getNativeRefreshToken()
        if (!stored) return false
        headers['X-Refresh-Token'] = stored
      }
      const res = await fetch(getServerUrl() + '/api/auth/refresh', { method: 'POST', credentials: 'include', headers })
      if (!res.ok) return false
      const data = (await res.json()) as AuthResponse
      useAuthStore.getState().setAuth(data.accessToken, data.user)
      if (isNative() && data.refreshToken) setNativeRefreshToken(data.refreshToken)
      return true
    } catch {
      return false
    } finally {
      refreshPromise = null
    }
  })()
  return refreshPromise
}

/** Bearer + one-shot 401 refresh. Returns the raw response so callers can pick how to read it. */
async function send(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = useAuthStore.getState().accessToken
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json')

  const res = await fetch(getServerUrl() + path, { ...init, headers, credentials: 'include' })

  if (res.status === 401 && retry) {
    const ok = await tryRefresh()
    if (ok) return send(path, init, false)
    if (isNative()) setNativeRefreshToken(null)
    useAuthStore.getState().clear()
    throw new ApiError(401, 'Session expired')
  }

  return res
}

export async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const res = await send(path, init, retry)

  if (res.status === 204) return undefined as T

  const body = await res.json().catch(() => ({}))

  if (!res.ok) {
    const message = (body as { detail?: string; title?: string }).detail
      ?? (body as { title?: string }).title
      ?? res.statusText
    throw new ApiError(res.status, message)
  }

  return body as T
}

/** For endpoints that answer with text rather than JSON. Errors still carry a problem-details body. */
export async function requestText(path: string, init: RequestInit = {}): Promise<string> {
  const res = await send(path, init)
  const body = await res.text()

  if (!res.ok) {
    let message = res.statusText
    try {
      const problem = JSON.parse(body) as { detail?: string; title?: string }
      message = problem.detail ?? problem.title ?? message
    } catch { /* not a problem-details body */ }
    throw new ApiError(res.status, message)
  }

  return body
}

export const activitiesApi = {
  get: (id: string) => request<Activity>(`/api/activities/${id}`),

  list: (params?: { goalId?: string }) => {
    const q = new URLSearchParams()
    if (params?.goalId) q.set('goalId', params.goalId)
    return request<Activity[]>(`/api/activities${q.size ? `?${q}` : ''}`)
  },

  // Omitting the two state fields leaves them untouched; sending [] clears them. The bulk-assign
  // path relies on that, since it resends everything it is not changing and knows nothing about states.
  create: (body: { title: string; categoryId?: string | null; goalId?: string | null; activityTypeId?: string | null; setsStateValues?: ActivityStateEffect[]; requiredStateValueIds?: string[] }) =>
    request<Activity>('/api/activities', { method: 'POST', body: JSON.stringify(body) }),

  update: (id: string, body: { title: string; categoryId?: string | null; goalId?: string | null; excludeFromRecommendations?: boolean; activityTypeId?: string | null; setsStateValues?: ActivityStateEffect[]; requiredStateValueIds?: string[] }) =>
    request<Activity>(`/api/activities/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  setRecommendations: (id: string, excludeFromRecommendations: boolean) =>
    request<Activity>(`/api/activities/${id}/recommendations`, {
      method: 'PATCH',
      body: JSON.stringify({ excludeFromRecommendations }),
    }),

  delete: (id: string) => request<void>(`/api/activities/${id}`, { method: 'DELETE' }),
}

export const activitySubtasksApi = {
  create: (activityId: string, body: { title: string }) =>
    request<ActivitySubtask>(`/api/activities/${activityId}/subtasks`, { method: 'POST', body: JSON.stringify(body) }),

  update: (activityId: string, id: string, body: { title: string }) =>
    request<ActivitySubtask>(`/api/activities/${activityId}/subtasks/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  delete: (activityId: string, id: string) =>
    request<void>(`/api/activities/${activityId}/subtasks/${id}`, { method: 'DELETE' }),
}

export const occurrenceSubtasksApi = {
  create: (occurrenceId: string, body: { title: string }) =>
    request<Occurrence>(`/api/occurrences/${occurrenceId}/subtasks`, { method: 'POST', body: JSON.stringify(body) }),

  update: (occurrenceId: string, id: string, body: { title: string }) =>
    request<Occurrence>(`/api/occurrences/${occurrenceId}/subtasks/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  delete: (occurrenceId: string, id: string) =>
    request<Occurrence>(`/api/occurrences/${occurrenceId}/subtasks/${id}`, { method: 'DELETE' }),
}

// Full subtask set for occurrence updates: id set = keep existing, id null = create new.
// Existing subtasks missing from the list are deleted. Omit the field to leave subtasks untouched.
export interface SubtaskInput {
  id?: string | null
  title: string
}

export const occurrencesApi = {
  list: (params?: { status?: string; startFrom?: string; endBefore?: string; floating?: boolean; goalId?: string; activityId?: string }) => {
    const q = new URLSearchParams()
    if (params?.status) q.set('status', params.status)
    if (params?.startFrom) q.set('startFrom', params.startFrom)
    if (params?.endBefore) q.set('endBefore', params.endBefore)
    if (params?.floating) q.set('floating', 'true')
    if (params?.goalId) q.set('goalId', params.goalId)
    if (params?.activityId) q.set('activityId', params.activityId)
    return request<Occurrence[]>(`/api/occurrences${q.size ? `?${q}` : ''}`)
  },

  get: (id: string) => request<Occurrence>(`/api/occurrences/${id}`),

  create: (body: { activityId: string; title?: string | null; startAt?: string | null; endAt?: string | null; isAllDay?: boolean; isPlanned?: boolean; durationMinutes?: number | null }) =>
    request<Occurrence>('/api/occurrences', { method: 'POST', body: JSON.stringify(body) }),

  // activityId re-points the occurrence at another activity; omit it to leave the link alone.
  update: (id: string, body: { activityId?: string; title?: string | null; startAt?: string | null; endAt?: string | null; isAllDay?: boolean; isPlanned?: boolean; durationMinutes?: number | null; subtasks?: SubtaskInput[] }) =>
    request<Occurrence>(`/api/occurrences/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  delete: (id: string) => request<void>(`/api/occurrences/${id}`, { method: 'DELETE' }),

  setStatus: (id: string, status: import('./types').EventStatus) =>
    request<Occurrence>(`/api/occurrences/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),

  toggleSubtask: (id: string, subtaskId: string) =>
    request<Occurrence>(`/api/occurrences/${id}/subtasks/${subtaskId}/toggle`, { method: 'POST' }),

  createEvent: (body: { title: string; categoryId?: string | null; goalId?: string | null; startAt?: string | null; endAt?: string | null; isAllDay?: boolean; isPlanned?: boolean; durationMinutes?: number | null }) =>
    request<Occurrence>('/api/occurrences/event', { method: 'POST', body: JSON.stringify(body) }),

  updateEvent: (id: string, body: { title: string; categoryId?: string | null; goalId?: string | null; startAt?: string | null; endAt?: string | null; isAllDay?: boolean; isPlanned?: boolean; durationMinutes?: number | null; subtasks?: SubtaskInput[] }) =>
    request<Occurrence>(`/api/occurrences/${id}/event`, { method: 'PUT', body: JSON.stringify(body) }),
}

export const goalsApi = {
  list: (params?: { status?: string }) => {
    const q = new URLSearchParams()
    if (params?.status) q.set('status', params.status)
    return request<Goal[]>(`/api/goals${q.size ? `?${q}` : ''}`)
  },

  get: (id: string) => request<Goal>(`/api/goals/${id}`),

  create: (body: { title: string; description?: string | null; kind?: GoalKind; notes?: string | null }) =>
    request<Goal>('/api/goals', { method: 'POST', body: JSON.stringify(body) }),

  update: (id: string, body: { title: string; description?: string | null; kind?: GoalKind; notes?: string | null }) =>
    request<Goal>(`/api/goals/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  delete: (id: string) => request<void>(`/api/goals/${id}`, { method: 'DELETE' }),

  setStatus: (id: string, status: GoalStatus) =>
    request<Goal>(`/api/goals/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
}

export const checkpointsApi = {
  create: (goalId: string, body: { title: string; size: string; targetDate?: string | null }) =>
    request<Checkpoint>(`/api/goals/${goalId}/checkpoints`, { method: 'POST', body: JSON.stringify(body) }),

  update: (goalId: string, id: string, body: { title: string; size: string; targetDate?: string | null }) =>
    request<Checkpoint>(`/api/goals/${goalId}/checkpoints/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  delete: (goalId: string, id: string) =>
    request<void>(`/api/goals/${goalId}/checkpoints/${id}`, { method: 'DELETE' }),

  setStatus: (goalId: string, id: string, status: CheckpointStatus) =>
    request<Checkpoint>(`/api/goals/${goalId}/checkpoints/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
}

export const settingsApi = {
  get: () => request<UserSettings>('/api/settings'),
  /** Omitting `unaccountedStateValueIds` leaves the mask untouched; `[]` clears it. */
  update: (body: {
    maxFocusGoals: number
    dayBoundaryTime: string
    timezone: string
    maxCalendarSuggestions: number
    unaccountedStateValueIds?: string[]
  }) => request<UserSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(body) }),
}

export interface ActivityTypeBody {
  name: string
  icon?: string | null
  windowStart: string
  windowEnd: string
  minBlockMinutes: number
  maxPerDay: number
  cadencePriorDays: number
  minDueFraction: number
}

export const activityTypesApi = {
  list: () => request<ActivityType[]>('/api/activity-types'),
  create: (body: ActivityTypeBody) =>
    request<ActivityType>('/api/activity-types', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: ActivityTypeBody) =>
    request<ActivityType>(`/api/activity-types/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (id: string) => request<void>(`/api/activity-types/${id}`, { method: 'DELETE' }),
}

export const categoriesApi = {
  list: () => request<Category[]>('/api/categories'),
  create: (body: { name: string; color: string; icon?: string | null }) =>
    request<Category>('/api/categories', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: { name: string; color: string; icon?: string | null }) =>
    request<Category>(`/api/categories/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (id: string) => request<void>(`/api/categories/${id}`, { method: 'DELETE' }),
}

export const statesApi = {
  list: () => request<State[]>('/api/states'),
  /** `at` is an instant (ISO, UTC): what every state held then, and what put it there. */
  snapshot: (at: string) => request<StateSnapshot>(`/api/states/snapshot?at=${encodeURIComponent(at)}`),
  create: (body: { name: string }) =>
    request<State>('/api/states', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: { name: string }) =>
    request<State>(`/api/states/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (id: string) => request<void>(`/api/states/${id}`, { method: 'DELETE' }),
}

/**
 * Every write returns the whole parent state, so the cache is replaced rather than patched: adding a
 * default moves the flag off a sibling, and deleting one can promote another.
 */
export const stateValuesApi = {
  create: (stateId: string, body: { name: string; isDefault?: boolean }) =>
    request<State>(`/api/states/${stateId}/values`, { method: 'POST', body: JSON.stringify(body) }),
  update: (stateId: string, id: string, body: { name: string; isDefault?: boolean }) =>
    request<State>(`/api/states/${stateId}/values/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (stateId: string, id: string) =>
    request<State>(`/api/states/${stateId}/values/${id}`, { method: 'DELETE' }),
}

export const recommendationsApi = {
  list: (date?: string) => {
    const q = new URLSearchParams()
    if (date) q.set('date', date)
    return request<Recommendation[]>(`/api/recommendations${q.size ? `?${q}` : ''}`)
  },
}

export const insightsApi = {
  get: (period: number = 30) => request<Insights>(`/api/insights?period=${period}`),
  emptyProfile: () => request<InsightsEmptyProfile>('/api/insights/empty-profile'),
}

// The whole account as one Markdown document, for handing to a person or an LLM. Not a backup: the
// server renders prose, and there is nothing that reads it back.
export const exportApi = {
  get: () => requestText('/api/export'),
}

export const authApi = {
  register: (username: string, password: string, timezone: string) =>
    request<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, timezone }),
    }, false),

  login: (username: string, password: string) =>
    request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }, false),

  refresh: () =>
    request<AuthResponse>('/api/auth/refresh', { method: 'POST' }, false),

  logout: () => {
    const headers: Record<string, string> = {}
    if (isNative()) {
      const stored = getNativeRefreshToken()
      if (stored) headers['X-Refresh-Token'] = stored
      setNativeRefreshToken(null)
    }
    return request<void>('/api/auth/logout', { method: 'POST', headers })
  },

  me: () =>
    request<User>('/api/auth/me'),
}
