import { useAuthStore } from '@/store/auth'
import { getServerUrl, isNative, getNativeRefreshToken, setNativeRefreshToken } from './server-config'
import type { AuthResponse, User, Goal, GoalStatus, Checkpoint, CheckpointStatus, UserSettings, Recommendation, Category, Activity, Occurrence } from './types'

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

export async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = useAuthStore.getState().accessToken
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json')

  const res = await fetch(getServerUrl() + path, { ...init, headers, credentials: 'include' })

  if (res.status === 401 && retry) {
    const ok = await tryRefresh()
    if (ok) return request<T>(path, init, false)
    if (isNative()) setNativeRefreshToken(null)
    useAuthStore.getState().clear()
    throw new ApiError(401, 'Session expired')
  }

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

export const activitiesApi = {
  list: (params?: { goalId?: string }) => {
    const q = new URLSearchParams()
    if (params?.goalId) q.set('goalId', params.goalId)
    return request<Activity[]>(`/api/activities${q.size ? `?${q}` : ''}`)
  },

  create: (body: { title: string; categoryId?: string | null; goalId?: string | null }) =>
    request<Activity>('/api/activities', { method: 'POST', body: JSON.stringify(body) }),

  update: (id: string, body: { title: string; categoryId?: string | null; goalId?: string | null }) =>
    request<Activity>(`/api/activities/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  delete: (id: string) => request<void>(`/api/activities/${id}`, { method: 'DELETE' }),
}

export const occurrencesApi = {
  list: (params?: { status?: string; startFrom?: string; endBefore?: string; floating?: boolean }) => {
    const q = new URLSearchParams()
    if (params?.status) q.set('status', params.status)
    if (params?.startFrom) q.set('startFrom', params.startFrom)
    if (params?.endBefore) q.set('endBefore', params.endBefore)
    if (params?.floating) q.set('floating', 'true')
    return request<Occurrence[]>(`/api/occurrences${q.size ? `?${q}` : ''}`)
  },

  get: (id: string) => request<Occurrence>(`/api/occurrences/${id}`),

  create: (body: { activityId: string; title?: string | null; startAt?: string | null; endAt?: string | null; isAllDay?: boolean; isPlanned?: boolean; durationMinutes?: number | null }) =>
    request<Occurrence>('/api/occurrences', { method: 'POST', body: JSON.stringify(body) }),

  update: (id: string, body: { title?: string | null; startAt?: string | null; endAt?: string | null; isAllDay?: boolean; isPlanned?: boolean; durationMinutes?: number | null }) =>
    request<Occurrence>(`/api/occurrences/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  delete: (id: string) => request<void>(`/api/occurrences/${id}`, { method: 'DELETE' }),

  setStatus: (id: string, status: import('./types').EventStatus) =>
    request<Occurrence>(`/api/occurrences/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),

  createEvent: (body: { title: string; categoryId?: string | null; goalId?: string | null; startAt?: string | null; endAt?: string | null; isAllDay?: boolean; isPlanned?: boolean; durationMinutes?: number | null }) =>
    request<Occurrence>('/api/occurrences/event', { method: 'POST', body: JSON.stringify(body) }),

  updateEvent: (id: string, body: { title: string; categoryId?: string | null; goalId?: string | null; startAt?: string | null; endAt?: string | null; isAllDay?: boolean; isPlanned?: boolean; durationMinutes?: number | null }) =>
    request<Occurrence>(`/api/occurrences/${id}/event`, { method: 'PUT', body: JSON.stringify(body) }),
}

export const goalsApi = {
  list: (params?: { status?: string }) => {
    const q = new URLSearchParams()
    if (params?.status) q.set('status', params.status)
    return request<Goal[]>(`/api/goals${q.size ? `?${q}` : ''}`)
  },

  get: (id: string) => request<Goal>(`/api/goals/${id}`),

  create: (body: { title: string; description?: string | null; categoryId?: string | null }) =>
    request<Goal>('/api/goals', { method: 'POST', body: JSON.stringify(body) }),

  update: (id: string, body: { title: string; description?: string | null; categoryId?: string | null }) =>
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
  update: (body: { maxFocusGoals: number; dayBoundaryTime: string; timezone: string }) =>
    request<UserSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(body) }),
}

export const categoriesApi = {
  list: () => request<Category[]>('/api/categories'),
  create: (body: { name: string; color: string; icon?: string | null }) =>
    request<Category>('/api/categories', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: { name: string; color: string; icon?: string | null }) =>
    request<Category>(`/api/categories/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (id: string) => request<void>(`/api/categories/${id}`, { method: 'DELETE' }),
}

export const recommendationsApi = {
  list: (date?: string) => {
    const q = new URLSearchParams()
    if (date) q.set('date', date)
    return request<Recommendation[]>(`/api/recommendations${q.size ? `?${q}` : ''}`)
  },
}

export const authApi = {
  register: (username: string, password: string, timezone: string) =>
    request<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, timezone }),
    }),

  login: (username: string, password: string) =>
    request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

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
