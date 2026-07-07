import { useAuthStore } from '@/store/auth'
import type { AuthResponse, User, Goal, GoalStatus, Checkpoint, CheckpointStatus, UserSettings, Recommendation } from './types'

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
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
      if (!res.ok) return false
      const data = (await res.json()) as AuthResponse
      useAuthStore.getState().setAuth(data.accessToken, data.user)
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

  const res = await fetch(path, { ...init, headers, credentials: 'include' })

  if (res.status === 401 && retry) {
    const ok = await tryRefresh()
    if (ok) return request<T>(path, init, false)
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

export const eventsApi = {
  list: (params?: { status?: string; startFrom?: string; endBefore?: string; floating?: boolean }) => {
    const q = new URLSearchParams()
    if (params?.status) q.set('status', params.status)
    if (params?.startFrom) q.set('startFrom', params.startFrom)
    if (params?.endBefore) q.set('endBefore', params.endBefore)
    if (params?.floating) q.set('floating', 'true')
    return request<import('./types').Event[]>(`/api/events${q.size ? `?${q}` : ''}`)
  },

  get: (id: string) => request<import('./types').Event>(`/api/events/${id}`),

  create: (body: { title: string; startAt?: string | null; endAt?: string | null; goalIds?: string[] }) =>
    request<import('./types').Event>('/api/events', { method: 'POST', body: JSON.stringify(body) }),

  update: (id: string, body: { title: string; startAt?: string | null; endAt?: string | null; goalIds?: string[] }) =>
    request<import('./types').Event>(`/api/events/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  delete: (id: string) => request<void>(`/api/events/${id}`, { method: 'DELETE' }),

  setStatus: (id: string, status: import('./types').EventStatus) =>
    request<import('./types').Event>(`/api/events/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
}

export const goalsApi = {
  list: (params?: { status?: string }) => {
    const q = new URLSearchParams()
    if (params?.status) q.set('status', params.status)
    return request<Goal[]>(`/api/goals${q.size ? `?${q}` : ''}`)
  },

  get: (id: string) => request<Goal>(`/api/goals/${id}`),

  create: (body: { title: string; description?: string | null }) =>
    request<Goal>('/api/goals', { method: 'POST', body: JSON.stringify(body) }),

  update: (id: string, body: { title: string; description?: string | null }) =>
    request<Goal>(`/api/goals/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  delete: (id: string) => request<void>(`/api/goals/${id}`, { method: 'DELETE' }),

  setStatus: (id: string, status: GoalStatus) =>
    request<Goal>(`/api/goals/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
}

export const checkpointsApi = {
  create: (goalId: string, body: { title: string; plannedProgress: number; targetDate?: string | null }) =>
    request<Checkpoint>(`/api/goals/${goalId}/checkpoints`, { method: 'POST', body: JSON.stringify(body) }),

  update: (goalId: string, id: string, body: { title: string; plannedProgress: number; targetDate?: string | null }) =>
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

  logout: () =>
    request<void>('/api/auth/logout', { method: 'POST' }),

  me: () =>
    request<User>('/api/auth/me'),
}
