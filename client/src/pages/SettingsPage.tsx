import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { LogOut, Monitor, Moon, Sun } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { settingsApi, authApi, ApiError } from '@/lib/api'
import { useAuthStore } from '@/store/auth'
import { getThemePref, setThemePref, type ThemePref } from '@/lib/theme'

function timezoneOptions(current: string): string[] {
  const supported =
    'supportedValuesOf' in Intl
      ? (Intl as { supportedValuesOf(key: string): string[] }).supportedValuesOf('timeZone')
      : []
  return supported.includes(current) || !current ? supported : [current, ...supported]
}

const THEME_OPTIONS: { value: ThemePref; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="mb-4 text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  )
}

export function SettingsPage() {
  const qc = useQueryClient()
  const { user, clear } = useAuthStore()
  const [theme, setTheme] = useState<ThemePref>(getThemePref)

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
      // Timezone and day boundary change what counts as today/overdue
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
    },
  })

  async function handleLogout() {
    try {
      await authApi.logout()
    } finally {
      clear()
    }
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
        <div className="mx-auto flex max-w-lg flex-col gap-4">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : (
            <>
              <Section title="Planning">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="timezone" className="text-sm font-medium text-foreground">
                      Timezone
                    </label>
                    <select
                      id="timezone"
                      value={form.timezone}
                      onChange={(e) => {
                        setSaved(false)
                        setForm((f) => ({ ...f, timezone: e.target.value }))
                      }}
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {timezoneOptions(form.timezone).map((tz) => (
                        <option key={tz} value={tz}>
                          {tz}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      Used to decide which day an event belongs to.
                    </p>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Field
                      label="Day boundary"
                      type="time"
                      value={form.dayBoundaryTime}
                      onChange={(e) => {
                        setSaved(false)
                        setForm((f) => ({ ...f, dayBoundaryTime: e.target.value }))
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      When your day rolls over. Before this time still counts as the previous day.
                    </p>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Field
                      label="Max focus goals"
                      type="number"
                      min={1}
                      max={20}
                      value={form.maxFocusGoals}
                      onChange={(e) => {
                        setSaved(false)
                        setForm((f) => ({ ...f, maxFocusGoals: Number(e.target.value) }))
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      Hard limit on how many goals can be in Focus at once.
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <Button size="sm" onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>
                      Save
                    </Button>
                    {saved && !saveMutation.isPending && (
                      <span className="text-xs text-muted-foreground">Saved.</span>
                    )}
                    {saveError && <span className="text-xs text-destructive">{saveError}</span>}
                  </div>
                </div>
              </Section>

              <Section title="Appearance">
                <div className="flex gap-2">
                  {THEME_OPTIONS.map(({ value, label, Icon }) => (
                    <button
                      key={value}
                      onClick={() => selectTheme(value)}
                      className={`flex flex-1 flex-col items-center gap-1.5 rounded-lg border py-3 text-xs font-medium transition-colors ${
                        theme === value
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-border text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      <Icon className="h-4 w-4" strokeWidth={2} />
                      {label}
                    </button>
                  ))}
                </div>
              </Section>

              <Section title="Account">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{user?.username}</p>
                    <p className="text-xs text-muted-foreground">Signed in</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleLogout}>
                    <LogOut className="mr-1.5 h-3.5 w-3.5" strokeWidth={2} />
                    Sign out
                  </Button>
                </div>
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
