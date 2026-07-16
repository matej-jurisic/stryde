import { useEffect, useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { LogOut, Monitor, Moon, Sun } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { settingsApi, authApi, ApiError } from '@/lib/api'
import { useAuthStore } from '@/store/auth'
import { getThemePref, setThemePref, type ThemePref } from '@/lib/theme'
import { isNative, getServerUrl, setServerUrl } from '@/lib/server-config'

function timezoneOptions(current: string): string[] {
  const supported =
    'supportedValuesOf' in Intl
      ? (Intl as { supportedValuesOf(key: string): string[] }).supportedValuesOf('timeZone')
      : []
  return supported.includes(current) || !current ? supported : [current, ...supported]
}

const THEME_OPTIONS: { value: ThemePref; label: string; Icon: typeof Sun }[] = [
  { value: 'light',  label: 'Light',  Icon: Sun },
  { value: 'dark',   label: 'Dark',   Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
]

// ── layout primitives ──────────────────────────────────────────────────────

function SettingSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="overflow-hidden rounded-lg border border-border bg-card divide-y divide-border">
        {children}
      </div>
    </section>
  )
}

function SettingRow({ label, hint, children }: { label: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  )
}

function SectionFooter({ status, error, onSave, isPending, label = 'Save changes' }: {
  status?: string
  error?: string | null
  onSave: () => void
  isPending: boolean
  label?: string
}) {
  return (
    <div className="flex items-center justify-end gap-3 bg-muted/40 px-4 py-3">
      {error && <span className="text-xs text-destructive">{error}</span>}
      {status && !error && <span className="text-xs text-muted-foreground">{status}</span>}
      <Button size="sm" onClick={onSave} loading={isPending}>{label}</Button>
    </div>
  )
}

const inputCls =
  'h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring'

// ── page ───────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const qc = useQueryClient()
  const { user, clear } = useAuthStore()
  const [theme, setTheme] = useState<ThemePref>(getThemePref)
  const [serverUrl, setServerUrlState] = useState(getServerUrl)
  const [serverUrlSaved, setServerUrlSaved] = useState(false)

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  })

  const [form, setForm] = useState({ timezone: '', dayBoundaryTime: '00:00', maxFocusGoals: 3 })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (settings) {
      setForm({
        timezone: settings.timezone,
        dayBoundaryTime: settings.dayBoundaryTime,
        maxFocusGoals: settings.maxFocusGoals,
      })
    }
  }, [settings])

  const saveMutation = useMutation({
    mutationFn: () => settingsApi.update(form),
    onSuccess: () => {
      setSaved(true)
      qc.invalidateQueries({ queryKey: ['settings'] })
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
    },
  })


  async function handleLogout() {
    try { await authApi.logout() } finally { clear() }
  }

  function selectTheme(pref: ThemePref) {
    setTheme(pref)
    setThemePref(pref)
  }

  const saveError =
    saveMutation.error instanceof ApiError
      ? saveMutation.error.message
      : saveMutation.error
        ? 'Something went wrong.'
        : null

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader title="Settings" />

      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <div className="mx-auto max-w-lg">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : (
            <div className="flex flex-col gap-6">

              <SettingSection label="Planning">
                <SettingRow label="Timezone">
                  <select
                    value={form.timezone}
                    onChange={(e) => { setSaved(false); setForm((f) => ({ ...f, timezone: e.target.value })) }}
                    className={`${inputCls} max-w-[200px]`}
                  >
                    {timezoneOptions(form.timezone).map((tz) => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </select>
                </SettingRow>

                <SettingRow label="Day start">
                  <input
                    type="time"
                    value={form.dayBoundaryTime}
                    onChange={(e) => { setSaved(false); setForm((f) => ({ ...f, dayBoundaryTime: e.target.value })) }}
                    className={inputCls}
                  />
                </SettingRow>

                <SettingRow label="Max focus goals">
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={form.maxFocusGoals}
                    onChange={(e) => { setSaved(false); setForm((f) => ({ ...f, maxFocusGoals: Number(e.target.value) })) }}
                    className={`${inputCls} w-16 text-center`}
                  />
                </SettingRow>

                <SectionFooter
                  status={saved && !saveMutation.isPending ? 'Changes saved.' : undefined}
                  error={saveError}
                  onSave={() => saveMutation.mutate()}
                  isPending={saveMutation.isPending}
                />
              </SettingSection>

              <SettingSection label="Appearance">
                <SettingRow label="Theme">
                  <div className="flex overflow-hidden rounded-md border border-border">
                    {THEME_OPTIONS.map(({ value, label, Icon }) => (
                      <button
                        key={value}
                        onClick={() => selectTheme(value)}
                        className={`flex items-center gap-1.5 border-l border-border px-3 py-1.5 text-xs font-medium transition-colors first:border-l-0 ${
                          theme === value
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                        {label}
                      </button>
                    ))}
                  </div>
                </SettingRow>
              </SettingSection>

              {isNative() && (
                <SettingSection label="Connection">
                  <SettingRow label="Server URL">
                    <input
                      type="url"
                      placeholder="http://192.168.1.100:8080"
                      value={serverUrl}
                      onChange={(e) => { setServerUrlSaved(false); setServerUrlState(e.target.value) }}
                      className={`${inputCls} w-52`}
                    />
                  </SettingRow>
                  <SectionFooter
                    status={serverUrlSaved ? 'Saved.' : undefined}
                    onSave={() => { setServerUrl(serverUrl); setServerUrlSaved(true) }}
                    isPending={false}
                    label="Save"
                  />
                </SettingSection>
              )}

              <SettingSection label="Account">
                <SettingRow label={user?.username ?? ''} hint="Signed in">
                  <Button variant="outline" size="sm" onClick={handleLogout}>
                    <LogOut className="mr-1.5 h-3.5 w-3.5" strokeWidth={2} />
                    Sign out
                  </Button>
                </SettingRow>
              </SettingSection>

            </div>
          )}
        </div>
      </div>
    </div>
  )
}
