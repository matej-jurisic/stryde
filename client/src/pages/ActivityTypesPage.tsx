import { useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, CircleDashed, Plus, Shapes, Trash2 } from 'lucide-react'
import { activityTypesApi, ApiError, type ActivityTypeBody } from '@/lib/api'
import type { ActivityType } from '@/lib/types'
import { CADENCE_OPTIONS, COOLDOWN_OPTIONS, describeProfile } from '@/lib/activityTypes'
import { ICON_MAP } from '@/components/categories/categoryIcons'
import { ActivityTypeIcon, TYPE_ICON_NAMES } from '@/components/activities/ActivityTypeIcon'
import { ActivitiesTabs } from '@/components/activities/ActivitiesTabs'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { inputCls } from '@/components/ui/input'

const MAX_BLOCK_MINUTES = 480
const MAX_PER_DAY_CEILING = 24

const BLANK: ActivityTypeBody = {
  name: '',
  icon: null,
  windowStart: '08:00',
  windowEnd: '21:00',
  minBlockMinutes: 0,
  maxPerDay: 0,
  cadencePriorDays: 7,
  minDueFraction: 0,
}

/**
 * The user's activity types: scheduling presets they own outright. Nothing here is a built-in with
 * privileged values - every type is a row that can be renamed, retuned or deleted, and an activity
 * with no type is simply unconstrained.
 */
export function ActivityTypesPage() {
  const { data: types, isLoading } = useQuery({
    queryKey: ['activityTypes'],
    queryFn: activityTypesApi.list,
    staleTime: 5 * 60 * 1000,
  })
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  function startAdding() {
    setOpenId(null)
    setAdding(true)
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Activities"
        action={
          <button
            onClick={startAdding}
            aria-label="New type"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-foreground transition-colors hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        }
      />

      <ActivitiesTabs />

      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {isLoading || !types ? (
            <div className="flex justify-center py-16">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : (
            <>
              {adding && (
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                  <p className="border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    New type
                  </p>
                  <div className="bg-muted/20 px-4 py-4">
                    <TypeForm
                      initial={BLANK}
                      submitLabel="Create"
                      onCancel={() => setAdding(false)}
                      onDone={() => setAdding(false)}
                    />
                  </div>
                </div>
              )}

              {types.length === 0 ? (
                !adding && (
                  <div className="flex flex-col items-center gap-3 py-16 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Shapes className="h-6 w-6" strokeWidth={1.5} />
                    </div>
                    <p className="text-sm font-medium text-foreground">No types yet</p>
                    <button
                      onClick={startAdding}
                      className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                      New type
                    </button>
                  </div>
                )
              ) : (
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                  <ul className="divide-y divide-border">
                    {types.map((type) => (
                      <TypeRow
                        key={type.id}
                        type={type}
                        open={openId === type.id}
                        onToggle={() => setOpenId((id) => (id === type.id ? null : type.id))}
                      />
                    ))}
                  </ul>
                </div>
              )}

            </>
          )}
        </div>
      </div>
    </div>
  )
}

function TypeRow({ type, open, onToggle }: {
  type: ActivityType
  open: boolean
  onToggle: () => void
}) {
  const { placement } = describeProfile(type)

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <ActivityTypeIcon icon={type.icon} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-foreground">{type.name}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{placement}</p>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
          strokeWidth={2}
        />
      </button>

      {open && (
        <div className="border-t border-border bg-muted/20 px-4 py-4">
          <TypeForm
            key={type.id}
            initial={type}
            existing={type}
            submitLabel="Save"
            onCancel={onToggle}
          />
        </div>
      )}
    </li>
  )
}

function TypeForm({ initial, existing, submitLabel, onCancel, onDone }: {
  initial: ActivityTypeBody | ActivityType
  /** Present when editing: enables Delete and switches the write to a PUT. */
  existing?: ActivityType
  submitLabel: string
  onCancel: () => void
  onDone?: () => void
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState<ActivityTypeBody>(toBody(initial))
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // The server decides what a field resolved to, so an edit that was rejected or normalised does
  // not linger in the inputs contradicting the summary line above.
  useEffect(() => { setForm(toBody(initial)) }, [initial])

  function onSettled() {
    qc.invalidateQueries({ queryKey: ['activityTypes'] })
    // Activity rows carry the type's name and icon, and the engine resolves profiles per request.
    qc.invalidateQueries({ queryKey: ['activities'] })
    qc.invalidateQueries({ queryKey: ['recommendations'] })
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      existing ? activityTypesApi.update(existing.id, form) : activityTypesApi.create(form),
    onSuccess: () => { setSaved(true); onSettled(); onDone?.() },
  })

  const deleteMutation = useMutation({
    mutationFn: () => activityTypesApi.delete(existing!.id),
    onSuccess: () => { setConfirmDelete(false); onSettled(); onCancel() },
  })

  const error =
    saveMutation.error instanceof ApiError ? saveMutation.error.message
      : saveMutation.error ? 'Something went wrong.'
      : null

  function set<K extends keyof ActivityTypeBody>(key: K, value: ActivityTypeBody[K]) {
    setSaved(false)
    saveMutation.reset()
    setForm((f) => ({ ...f, [key]: value }))
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-foreground">Name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Errands"
            className={inputCls}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-1">
        <label className="text-xs font-medium text-foreground">Icon</label>
        <IconGrid value={form.icon ?? null} onChange={(icon) => set('icon', icon)} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {/* lang="en-GB" pins the native picker to 24h; without it the browser follows its own
            locale and renders AM/PM. The value is "HH:mm" either way. */}
        <Knob label="Window start" hint="Where an unplaced suggestion starts looking">
          <input
            type="time"
            lang="en-GB"
            value={form.windowStart}
            onChange={(e) => set('windowStart', e.target.value)}
            className={`${inputCls} w-full`}
          />
        </Knob>
        <Knob label="Window end" hint="Never placed later than this">
          <input
            type="time"
            lang="en-GB"
            value={form.windowEnd}
            onChange={(e) => set('windowEnd', e.target.value)}
            className={`${inputCls} w-full`}
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
            className={`${inputCls} w-full text-center`}
          />
        </Knob>
        <Knob label="Max per day" hint="Suggestions of this type. 0 for unlimited.">
          <input
            type="number"
            min={0}
            max={MAX_PER_DAY_CEILING}
            value={form.maxPerDay}
            onChange={(e) => set('maxPerDay', Number(e.target.value))}
            className={`${inputCls} w-full text-center`}
          />
        </Knob>
      </div>

      {/* Both are fractions of the activity's own history rather than clock values, so they are
          offered in words. The options are the whole range: a value typed in numerically would not
          survive a round trip through this form. */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-foreground">
            Assumed cadence
          </label>
          <select
            value={String(form.cadencePriorDays)}
            onChange={(e) => set('cadencePriorDays', Number(e.target.value))}
            className={`${inputCls} w-full`}
          >
            {CADENCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-foreground">
            Suggest again
          </label>
          <select
            value={String(form.minDueFraction)}
            onChange={(e) => set('minDueFraction', Number(e.target.value))}
            className={`${inputCls} w-full`}
          >
            {COOLDOWN_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Delete is the icon-only destructive button the app uses in a footer that also carries
          Cancel and Save (see EventDetailModal): `mr-auto` puts the whole width between it and the
          button a user actually means to press. */}
      <div className="mt-4 flex items-center justify-end gap-3">
        {existing && (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={deleteMutation.isPending}
            aria-label={`Delete ${existing.name}`}
            title="Delete type"
            className="mr-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
          >
            {deleteMutation.isPending
              ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              : <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />}
          </button>
        )}
        {error && <span className="text-xs text-destructive">{error}</span>}
        {saved && !error && !saveMutation.isPending && (
          <span className="text-xs text-muted-foreground">Saved.</span>
        )}
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>
          {submitLabel}
        </Button>
      </div>

      {existing && (
        <ConfirmDialog
          open={confirmDelete}
          title={`Delete ${existing.name}?`}
          message="Activities using it keep working, with no type: they get scheduled anywhere there is room."
          confirmLabel="Delete"
          loading={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate()}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  )
}

function toBody(t: ActivityTypeBody | ActivityType): ActivityTypeBody {
  return {
    name: t.name,
    icon: t.icon ?? null,
    windowStart: t.windowStart,
    windowEnd: t.windowEnd,
    minBlockMinutes: t.minBlockMinutes,
    maxPerDay: t.maxPerDay,
    cadencePriorDays: t.cadencePriorDays,
    minDueFraction: t.minDueFraction,
  }
}

/**
 * Like the category picker minus the colour (a type has no colour of its own), but over the short
 * `TYPE_ICON_NAMES` slice so the whole set fits without scrolling. Fixed columns rather than wrap,
 * so the last row is never a ragged stub. A value from outside the slice is appended rather than
 * dropped, so an older type still shows what it is set to.
 */
function IconGrid({ value, onChange }: { value: string | null; onChange: (i: string | null) => void }) {
  const names = value && !TYPE_ICON_NAMES.includes(value) ? [...TYPE_ICON_NAMES, value] : TYPE_ICON_NAMES

  return (
    <div className="grid grid-cols-8 justify-items-center gap-1.5 sm:grid-cols-12">
      <button
        type="button"
        onClick={() => onChange(null)}
        title="No icon"
        className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
          value === null ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:border-primary/50'
        }`}
      >
        <ActivityTypeIcon icon={null} className="h-[15px] w-[15px]" />
      </button>
      {names.map((name) => {
        const Icon = ICON_MAP[name] ?? CircleDashed
        const selected = value === name
        return (
          <button
            key={name}
            type="button"
            onClick={() => onChange(name)}
            title={name}
            className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
              selected ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:border-primary/50'
            }`}
          >
            <Icon style={{ width: 15, height: 15 }} strokeWidth={2} />
          </button>
        )
      })}
    </div>
  )
}

function Knob({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-foreground">{label}</label>
      {children}
      {hint && <p className="text-[11px] leading-tight text-muted-foreground">{hint}</p>}
    </div>
  )
}
