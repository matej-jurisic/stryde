import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Plus, Star, X } from 'lucide-react'
import { statesApi, stateValuesApi } from '@/lib/api'
import type { State } from '@/lib/types'
import { formatStateDuration } from '@/lib/useStates'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toastError } from '@/store/toasts'
import { SettingSection, inputCls } from './SettingSection'

/** Thirty days, matching StateService.MaxDurationMinutes. */
const MAX_DURATION_MINUTES = 43200

/**
 * States: user-defined context the suggestion engine gates on. Each state holds an ordered value list,
 * one of which is the default. A value may expire after a while, which is what lets a state change back
 * on its own instead of needing something scheduled to undo it.
 */
export function StateSettings() {
  const qc = useQueryClient()
  const { data: states, isLoading } = useQuery({
    queryKey: ['states'],
    queryFn: statesApi.list,
    staleTime: 5 * 60 * 1000,
  })
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  const createMutation = useMutation({
    mutationFn: () => statesApi.create({ name: newName.trim() }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['states'] })
      setNewName('')
      setAdding(false)
      // Opened straight away: a state with no values does nothing yet, so the next step is adding them.
      setOpenId(created.id)
    },
    onError: (err) => toastError(err, 'Could not create the state.'),
  })

  if (isLoading || !states) {
    return (
      <SettingSection label="States">
        <div className="flex justify-center px-4 py-6">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </SettingSection>
    )
  }

  return (
    <SettingSection label="States">
      {states.length === 0 && !adding && (
        <p className="px-4 py-3.5 text-xs text-muted-foreground">
          Nothing yet. A state is something about the world that changes what makes sense to do, like
          Location being Home or Work.
        </p>
      )}

      {states.map((state) => (
        <StateRow
          key={state.id}
          state={state}
          open={openId === state.id}
          onToggle={() => setOpenId((id) => (id === state.id ? null : state.id))}
        />
      ))}

      <div className="flex items-center gap-2 bg-muted/40 px-4 py-3">
        {adding ? (
          <>
            <input
              type="text"
              autoFocus
              placeholder="Location"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newName.trim()) createMutation.mutate()
                if (e.key === 'Escape') setAdding(false)
              }}
              className={`${inputCls} flex-1`}
            />
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
            <Button
              size="sm"
              onClick={() => createMutation.mutate()}
              disabled={!newName.trim()}
              loading={createMutation.isPending}
            >
              Add
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" strokeWidth={2} />
            Add state
          </Button>
        )}
      </div>
    </SettingSection>
  )
}

function StateRow({ state, open, onToggle }: { state: State; open: boolean; onToggle: () => void }) {
  const qc = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [newValue, setNewValue] = useState('')
  const [newDuration, setNewDuration] = useState('')

  // Every value write returns the whole state, so the cache is replaced rather than patched: the
  // default flag can move to a sibling and a delete can promote one.
  function onSettled(next: State) {
    qc.setQueryData(['states'], (prev: State[] | undefined) =>
      prev?.map((s) => (s.id === next.id ? next : s)) ?? [next])
    qc.invalidateQueries({ queryKey: ['recommendations'] })
  }

  const addValueMutation = useMutation({
    mutationFn: () => stateValuesApi.create(state.id, {
      name: newValue.trim(),
      durationMinutes: newDuration ? Number(newDuration) : null,
    }),
    onSuccess: (next) => {
      onSettled(next)
      setNewValue('')
      setNewDuration('')
    },
    onError: (err) => toastError(err, 'Could not add the value.'),
  })

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) => {
      const value = state.values.find((v) => v.id === id)!
      // Becoming the default means giving up any expiry: the default is what expiries fall back to.
      return stateValuesApi.update(state.id, id, {
        name: value.name,
        isDefault: true,
        durationMinutes: null,
      })
    },
    onSuccess: onSettled,
    onError: (err) => toastError(err, 'Could not change the default.'),
  })

  const deleteValueMutation = useMutation({
    mutationFn: (id: string) => stateValuesApi.delete(state.id, id),
    onSuccess: onSettled,
    onError: (err) => toastError(err, 'Could not delete the value.'),
  })

  const deleteStateMutation = useMutation({
    mutationFn: () => statesApi.delete(state.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['states'] })
      qc.invalidateQueries({ queryKey: ['activities'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
      setConfirmDelete(false)
    },
    onError: (err) => toastError(err, 'Could not delete the state.'),
  })

  const summary = state.values.length === 0
    ? 'No values yet'
    : state.values.map((v) => v.name).join(', ')

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/40"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm text-foreground">{state.name}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{summary}</p>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`}
          strokeWidth={2}
        />
      </button>

      {open && (
        <div className="border-t border-border bg-muted/20 px-4 py-4">
          {state.values.length > 0 && (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-background">
              {state.values.map((value) => (
                <li key={value.id} className="flex items-center gap-2 px-3 py-2">
                  <button
                    type="button"
                    title={value.isDefault ? 'The default value' : 'Make this the default'}
                    aria-pressed={value.isDefault}
                    disabled={value.isDefault || setDefaultMutation.isPending}
                    onClick={() => setDefaultMutation.mutate(value.id)}
                    className={`shrink-0 rounded p-0.5 ${
                      value.isDefault
                        ? 'text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Star
                      className="h-3.5 w-3.5"
                      strokeWidth={2}
                      fill={value.isDefault ? 'currentColor' : 'none'}
                    />
                  </button>
                  <span className="flex-1 text-sm text-foreground">{value.name}</span>
                  {value.durationMinutes !== null && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatStateDuration(value.durationMinutes)}
                    </span>
                  )}
                  <button
                    type="button"
                    title="Delete value"
                    disabled={deleteValueMutation.isPending}
                    onClick={() => deleteValueMutation.mutate(value.id)}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-2 flex gap-2">
            <input
              type="text"
              placeholder="Add a value..."
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newValue.trim()) {
                  e.preventDefault()
                  addValueMutation.mutate()
                }
              }}
              className={`${inputCls} flex-1`}
            />
            <input
              type="number"
              min={1}
              max={MAX_DURATION_MINUTES}
              placeholder="mins"
              title="Minutes before it falls back to the default. Leave empty to hold until something else changes it."
              value={newDuration}
              onChange={(e) => setNewDuration(e.target.value)}
              className={`${inputCls} w-20 text-center`}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => addValueMutation.mutate()}
              disabled={!newValue.trim() || addValueMutation.isPending}
            >
              Add
            </Button>
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            The starred value is what this state holds until an activity changes it. Give another value
            a length in minutes and it goes back to the default on its own after that, so a workout can
            leave you tired for a day without anything being scheduled to undo it.
          </p>

          <div className="mt-4 flex items-center justify-end gap-3">
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)}>
              Delete state
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => deleteStateMutation.mutate()}
        title={`Delete ${state.name}?`}
        message="Activities using it will be kept, but they stop being gated on it."
        confirmLabel="Delete"
        loading={deleteStateMutation.isPending}
      />
    </div>
  )
}
