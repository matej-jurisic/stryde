import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, LogOut, Monitor, Moon, Sun } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { SettingSection, SettingRow, SectionFooter, inputCls } from '@/components/settings/SettingSection'
import { settingsApi, authApi, exportApi, llmApi, ApiError } from '@/lib/api'
import { toastError } from '@/store/toasts'
import { useAuthStore } from '@/store/auth'
import { getThemePref, setThemePref, type ThemePref } from '@/lib/theme'
import { isNative, getServerUrl, setServerUrl } from '@/lib/server-config'
import { useStates } from '@/lib/useStates'
import { StateValuePicker } from '@/components/activities/StateValuePicker'

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

/**
 * Which section's Save button was last used. Every section writes the same settings row through one
 * mutation, so this is only about putting "Changes saved." under the button that was pressed.
 */
type SavedSection = 'planning' | 'insights' | 'assistant'

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

  const { states } = useStates()
  const hasStates = states.some((s) => s.values.length > 0)

  const [form, setForm] = useState({
    timezone: '',
    dayBoundaryTime: '00:00',
    maxFocusGoals: 3,
    maxCalendarSuggestions: 6,
    unaccountedStateValueIds: [] as string[],
    llmEnabled: false,
    llmBaseUrl: '',
    llmModel: '',
    llmTimeoutSeconds: 180,
    llmNoThink: false,
  })
  const [savedSection, setSavedSection] = useState<SavedSection | null>(null)

  // Every edit clears the confirmation, so "Changes saved." never describes a stale value.
  function edit(patch: Partial<typeof form>) {
    setSavedSection(null)
    setForm((f) => ({ ...f, ...patch }))
  }

  useEffect(() => {
    if (settings) {
      setForm({
        timezone: settings.timezone,
        dayBoundaryTime: settings.dayBoundaryTime,
        maxFocusGoals: settings.maxFocusGoals,
        maxCalendarSuggestions: settings.maxCalendarSuggestions,
        unaccountedStateValueIds: settings.unaccountedStateValueIds,
        llmEnabled: settings.llmEnabled,
        llmBaseUrl: settings.llmBaseUrl ?? '',
        llmModel: settings.llmModel ?? '',
        llmTimeoutSeconds: settings.llmTimeoutSeconds,
        llmNoThink: settings.llmNoThink,
      })
    }
  }, [settings])

  const saveMutation = useMutation({
    mutationFn: (_section: SavedSection) => settingsApi.update(form),
    onSuccess: (_data, section) => {
      setSavedSection(section)
      qc.invalidateQueries({ queryKey: ['settings'] })
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
      // The mask decides which hours the unaccounted-time stats look at, so every figure moves.
      qc.invalidateQueries({ queryKey: ['insights'] })
    },
  })

  // Reachability check. Reads the *saved* settings rather than the form, so a failure after editing
  // the address means "save first" - which is why every edit above clears the last result.
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; models: string[] } | null>(null)

  const testMutation = useMutation({
    mutationFn: llmApi.status,
    onSuccess: (status) => setTestResult({
      ok: status.modelAvailable,
      message: status.modelAvailable
        ? `Connected. "${status.model}" is ready.`
        : `Connected, but "${status.model}" is not pulled on that server.`,
      models: status.availableModels,
    }),
    onError: (err) => setTestResult({
      ok: false,
      message: err instanceof ApiError ? err.message : 'Could not reach the model server.',
      models: [],
    }),
  })

  function footerProps(section: SavedSection) {
    const isPending = saveMutation.isPending && saveMutation.variables === section
    return {
      status: savedSection === section && !isPending ? 'Changes saved.' : undefined,
      error: saveMutation.variables === section ? saveError : null,
      onSave: () => saveMutation.mutate(section),
      isPending,
    }
  }


  async function handleLogout() {
    try { await authApi.logout() } finally { clear() }
  }

  const [exporting, setExporting] = useState(false)

  async function handleExport() {
    setExporting(true)
    try {
      const markdown = await exportApi.get()
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `stryde-export-${new Date().toISOString().slice(0, 10)}.md`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toastError(err)
    } finally {
      setExporting(false)
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
                    onChange={(e) => edit({ timezone: e.target.value })}
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
                    lang="en-GB"
                    value={form.dayBoundaryTime}
                    onChange={(e) => edit({ dayBoundaryTime: e.target.value })}
                    className={inputCls}
                  />
                </SettingRow>

                <SettingRow label="Max focus goals">
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={form.maxFocusGoals}
                    onChange={(e) => edit({ maxFocusGoals: Number(e.target.value) })}
                    className={`${inputCls} w-16 text-center`}
                  />
                </SettingRow>

                <SettingRow
                  label="Calendar suggestions"
                  hint="How many suggested slots the calendar draws per day"
                >
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={form.maxCalendarSuggestions}
                    onChange={(e) => edit({ maxCalendarSuggestions: Number(e.target.value) })}
                    className={`${inputCls} w-16 text-center`}
                  />
                </SettingRow>

                <SectionFooter {...footerProps('planning')} />
              </SettingSection>

              {hasStates && (
                <SettingSection label="Insights">
                  <div className="flex flex-col gap-3 px-4 py-3.5">
                    <div>
                      <p className="text-sm text-foreground">Only count unaccounted time when</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Hours outside this are left out of the insights entirely rather than read as
                        free time you did not use, so a week away does not register as empty days.
                        Pick nothing to measure the whole day.
                      </p>
                    </div>
                    <StateValuePicker
                      states={states}
                      value={form.unaccountedStateValueIds}
                      onChange={(next) => edit({ unaccountedStateValueIds: next })}
                    />
                  </div>

                  <SectionFooter {...footerProps('insights')} />
                </SettingSection>
              )}

              <SettingSection label="Assistant">
                <SettingRow
                  label="Enable assistant"
                  hint="Lets the app send text to a local model you run yourself. Nothing leaves your network."
                >
                  <input
                    type="checkbox"
                    checked={form.llmEnabled}
                    onChange={(e) => edit({ llmEnabled: e.target.checked })}
                    className="h-4 w-4 rounded border-input accent-primary"
                  />
                </SettingRow>

                <SettingRow label="Server address" hint="Root of the Ollama server, without a path.">
                  <input
                    type="url"
                    placeholder="http://ollama:11434"
                    value={form.llmBaseUrl}
                    onChange={(e) => { setTestResult(null); edit({ llmBaseUrl: e.target.value }) }}
                    className={`${inputCls} w-52`}
                  />
                </SettingRow>

                <SettingRow label="Model" hint="The tag as Ollama knows it.">
                  <input
                    type="text"
                    placeholder="gemma3:27b"
                    value={form.llmModel}
                    onChange={(e) => { setTestResult(null); edit({ llmModel: e.target.value }) }}
                    className={`${inputCls} w-52`}
                  />
                </SettingRow>

                <SettingRow
                  label="Timeout"
                  hint="Seconds to wait for an answer. A large model on a CPU can take minutes."
                >
                  <input
                    type="number"
                    min={5}
                    max={900}
                    value={form.llmTimeoutSeconds}
                    onChange={(e) => edit({ llmTimeoutSeconds: Number(e.target.value) })}
                    className={`${inputCls} w-20 text-center`}
                  />
                </SettingRow>

                <SettingRow
                  label="Disable thinking"
                  hint="Reasoning models write out their thinking before answering, which at local speeds is pure waiting. Leave off unless your model has a thinking mode: models without one reject the request."
                >
                  <input
                    type="checkbox"
                    checked={form.llmNoThink}
                    onChange={(e) => edit({ llmNoThink: e.target.checked })}
                    className="h-4 w-4 rounded border-input accent-primary"
                  />
                </SettingRow>

                {testResult && (
                  <div className="px-4 py-3">
                    <p className={`text-xs ${testResult.ok ? 'text-muted-foreground' : 'text-destructive'}`}>
                      {testResult.message}
                    </p>
                    {testResult.models.length > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Available: {testResult.models.join(', ')}
                      </p>
                    )}
                  </div>
                )}

                <SectionFooter {...footerProps('assistant')}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => testMutation.mutate()}
                    loading={testMutation.isPending}
                  >
                    Test connection
                  </Button>
                </SectionFooter>
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

              <SettingSection label="Data">
                <SettingRow label="Export data" hint="Download everything as a readable Markdown document: settings, types, states, categories, goals, activities, and the full history. Meant for sharing, not for restoring.">
                  <Button variant="outline" size="sm" onClick={handleExport} loading={exporting}>
                    <Download className="mr-1.5 h-3.5 w-3.5" strokeWidth={2} />
                    Export
                  </Button>
                </SettingRow>
              </SettingSection>

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
