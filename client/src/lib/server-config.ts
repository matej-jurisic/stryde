import { Capacitor } from '@capacitor/core'

const KEY = 'stryde-server-url'
const RT_KEY = 'stryde_rt'

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

export function getNativeRefreshToken(): string | null {
  return localStorage.getItem(RT_KEY)
}

export function setNativeRefreshToken(token: string | null): void {
  if (token) localStorage.setItem(RT_KEY, token)
  else localStorage.removeItem(RT_KEY)
}
