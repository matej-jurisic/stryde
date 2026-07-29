import { useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { activityProfilesApi, ApiError } from '@/lib/api'
import type { ActivityProfile } from '@/lib/types'
import { ACTIVITY_TYPES, activityTypeMeta, describeProfile } from '@/lib/activityTypes'
import { Button } from '@/components/ui/Button'
import { SettingSection, inputCls } from './SettingSection'

const MAX_BLOCK_MINUTES = 480
const MAX_PER_DAY_CEILING = 24

/**
 * Per-type scheduling knobs. Only the four the user can reason about in wall-clock terms are
 * editable; cadence prior and cooldown are measured against the activity's own history, so they
 * are described here rather than exposed as inputs.
 */
export function ActivityTypeSettings() {
  const { data: profiles, isLoading } = useQuery({
    queryKey: ['activityProfiles'],
    queryFn: activityProfilesApi.list,
    staleTime: 5 * 60 * 1000,
  })
  const [openType, setOpenType] = useState<string | null>(null)

  if (isLoading || !profiles) {
    return (
      <SettingSection label="Activity types">
        <div className="flex justify-center px-4 py-6">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </SettingSection>
    )
  }

  const byType = new Map(profiles.map((p) => [p.type, p]))

  return (
    <SettingSection label="Activity types">
      {ACTIVITY_TYPES.map((meta) => {
        const profile = byType.get(meta.value)
        if (!profile) return null
        return (
          <TypeRow
            key={meta.value}
            profile={profile}
            open={openType === meta.value}
            onToggle={() => setOpenType((t) => (t === meta.value ? null : meta.value))}
          />
        )
      })}
    </SettingSection>
  )
}

function TypeRow({ profile, open, onToggle }: {
  profile: ActivityProfile
  open: boolean
  onToggle: () => void
}) {
  const qc = useQueryClient()
  const meta = activityTypeMeta(profile.type)
  const Icon = meta.icon
  const { placement, rhythm } = describeProfile(profile)

  const [form, setForm] = useState({
    windowStart: profile.windowStart,
    windowEnd: profile.windowEnd,
    minBlockMinutes: profile.minBlockMinutes,
    maxPerDay: profile.maxPerDay,
  })
  const [saved, setSaved] = useState(false)

  // The server is the source of truth for what a field resolved to, including a save that stored
  // nothing because the value matched the default. Re-syncs on open too, so collapsing a row
  // discards its unsaved edits rather than leaving them to contradict the summary line.
  useEffect(() => {
    setForm({
      windowStart: profile.windowStart,
      windowEnd: profile.windowEnd,
      minBlockMinutes: profile.minBlockMinutes,
      maxPerDay: profile.maxPerDay,
    })
  }, [profile, open])

  function onSettled(next: ActivityProfile[]) {
    qc.setQueryData(['activityProfiles'], next)
    qc.invalidateQueries({ queryKey: ['recommendations'] })
  }

  const saveMutation = useMutation({
    mutationFn: () => activityProfilesApi.update(profile.type, form),
    onSuccess: (next) => { setSaved(true); onSettled(next) },
  })

  const resetMutation = useMutation({
    mutationFn: () => activityProfilesApi.reset(profile.type),
    onSuccess: (next) => { setSaved(false); onSettled(next) },
  })

  const error =
    saveMutation.error instanceof ApiError ? saveMutation.error.message
      : saveMutation.error ? 'Something went wrong.'
      : null

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setSaved(false)
    saveMutation.reset()
    setForm((f) => ({ ...f, [key]: value }))
  }

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/40"
      >
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm text-foreground">
            {meta.label}
            {profile.isCustomised && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                Custom
              </span>
            )}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{placement}</p>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
          strokeWidth={2}
        />
      </button>

      {open && (
        <div className="border-t border-border bg-muted/20 px-4 py-4">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {/* lang="en-GB" pins the native picker to 24h; without it the browser follows its own
                locale and renders AM/PM. The value is "HH:mm" either way. */}
            <Knob label="Window start" hint="Where an unplaced suggestion starts looking">
              <input
                type="time"
                lang="en-GB"
                value={form.windowStart}
                onChange={(e) => set('windowStart', e.target.value)}
                className={inputCls}
              />
            </Knob>
            <Knob label="Window end" hint="Never placed later than this">
              <input
                type="time"
                lang="en-GB"
                value={form.windowEnd}
                onChange={(e) => set('windowEnd', e.target.value)}
                className={inputCls}
              />
            </Knob>
            <Knob label="Minimum block" hint="Free minutes needed. 0 for no floor.">
              <input
                type="number"
                min={0}
                max={MAX_BLOCK_MINUTES}
                step={5}
                value={form.minBlockMinutes}
                onChange={(e) => set('minBlockMinutes', Number(e.target.value))}
                className={`${inputCls} w-20 text-center`}
              />
            </Knob>
            <Knob label="Max per day" hint="Suggestions of this type. 0 for unlimited.">
              <input
                type="number"
                min={0}
                max={MAX_PER_DAY_CEILING}
                value={form.maxPerDay}
                onChange={(e) => set('maxPerDay', Number(e.target.value))}
                className={`${inputCls} w-20 text-center`}
              />
            </Knob>
          </div>

          {/* Cadence and cooldown are not editable: they are measured against the activity's own
              history, so a typed-in number has no predictable effect. Stated so the row still
              describes everything the type does. */}
          <p className="mt-4 text-xs text-muted-foreground">{rhythm}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            A habitual start time from your own history always wins over the window.
          </p>

          <div className="mt-4 flex items-center justify-end gap-3">
            {error && <span className="text-xs text-destructive">{error}</span>}
            {saved && !error && !saveMutation.isPending && (
              <span className="text-xs text-muted-foreground">Saved.</span>
            )}
            {profile.isCustomised && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => resetMutation.mutate()}
                loading={resetMutation.isPending}
              >
                Reset
              </Button>
            )}
            <Button size="sm" onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function Knob({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-foreground">{label}</label>
      {children}
      <p className="text-[11px] leading-tight text-muted-foreground">{hint}</p>
    </div>
  )
}
