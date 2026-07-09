import { Capacitor } from '@capacitor/core'

const KEY = 'stryde-server-url'

export const isNative = (): boolean => Capacitor.isNativePlatform()

export function getServerUrl(): string {
  return localStorage.getItem(KEY) ?? ''
}

export function setServerUrl(url: string): void {
  const trimmed = url.trim().replace(/\/$/, '')
  if (trimmed) {
    localStorage.setItem(KEY, trimmed)
  } else {
    localStorage.removeItem(KEY)
  }
}
