import { create } from 'zustand'
import { ApiError } from '@/lib/api'

export type ToastTone = 'error' | 'success'

export interface Toast {
  id: number
  message: string
  tone: ToastTone
}

interface ToastState {
  toasts: Toast[]
  push: (message: string, tone?: ToastTone) => void
  dismiss: (id: number) => void
}

let nextId = 1
const AUTO_DISMISS_MS = 5000

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, tone = 'error') => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, AUTO_DISMISS_MS)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/** Show an API error as a toast, falling back to a generic message. */
export function toastError(err: unknown, fallback = 'Something went wrong.') {
  useToastStore.getState().push(err instanceof ApiError ? err.message : fallback, 'error')
}
