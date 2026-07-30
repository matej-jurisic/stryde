import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Plus, Star, ToggleLeft, Trash2, X } from 'lucide-react'
import { statesApi, stateValuesApi } from '@/lib/api'
import type { State } from '@/lib/types'
import { ActivitiesTabs } from '@/components/activities/ActivitiesTabs'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { inputCls } from '@/components/ui/input'
import { toastError } from '@/store/toasts'

/**
 * States: user-defined context the suggestion engine gates on. Each state holds an ordered value list,
 * one of which is the default. How long a value holds is not set here but on the activities that cause
 * it, since the same value can last different lengths of time depending on what put it there.
 */
export function StatesPage() {
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

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Activities"
        action={
          <button
            onClick={() => setAdding(true)}
            aria-label="New state"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-foreground transition-colors hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        }
      />

      <ActivitiesTabs />

      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {isLoading || !states ? (
            <div className="flex justify-center py-16">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : (
            <>
              {adding && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
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
                </div>
              )}

              {states.length === 0 ? (
                !adding && (
                  <div className="flex flex-col items-center gap-3 py-16 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <ToggleLeft className="h-6 w-6" strokeWidth={1.5} />
                    </div>
                    <p className="text-sm font-medium text-foreground">No states yet</p>
                    <button
                      onClick={() => setAdding(true)}
                      className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                      New state
                    </button>
                  </div>
                )
              ) : (
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                  <ul className="divide-y divide-border">
                    {states.map((state) => (
                      <StateRow
                        key={state.id}
                        state={state}
                        open={openId === state.id}
                        onToggle={() => setOpenId((id) => (id === state.id ? null : state.id))}
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

function StateRow({ state, open, onToggle }: { state: State; open: boolean; onToggle: () => void }) {
  const qc = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [newValue, setNewValue] = useState('')
  // A state with no values does nothing yet, so that one case opens straight into the input. Every
  // other time the add row stays a single line until asked for: this list is read far more often
  // than it is written, and a permanently empty row is something to look past on every read.
  const [addingValue, setAddingValue] = useState(state.values.length === 0)

  function closeAdd() {
    setAddingValue(false)
    setNewValue('')
  }

  // Every value write returns the whole state, so the cache is replaced rather than patched: the
  // default flag can move to a sibling and a delete can promote one.
  function onSettled(next: State) {
    qc.setQueryData(['states'], (prev: State[] | undefined) =>
      prev?.map((s) => (s.id === next.id ? next : s)) ?? [next])
    qc.invalidateQueries({ queryKey: ['recommendations'] })
  }

  const addValueMutation = useMutation({
    mutationFn: () => stateValuesApi.create(state.id, { name: newValue.trim() }),
    onSuccess: (next) => {
      onSettled(next)
      setNewValue('')
    },
    onError: (err) => toastError(err, 'Could not add the value.'),
  })

  const canAdd = newValue.trim().length > 0 && !addValueMutation.isPending

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) => {
      const value = state.values.find((v) => v.id === id)!
      return stateValuesApi.update(state.id, id, { name: value.name, isDefault: true })
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
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-foreground">{state.name}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{summary}</p>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
          strokeWidth={2}
        />
      </button>

      {open && (
        <div className="border-t border-border bg-muted/20 px-4 py-4">
          {/* The add row is the last row of the value list, not a detached strip of controls under
              it: same columns, same card, so typing into it reads as writing the next value. */}
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
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
                <span className="flex-1 truncate text-sm text-foreground">{value.name}</span>
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

            <li className={addingValue ? 'flex items-center gap-2 px-3 py-2' : undefined}>
              {!addingValue ? (
                <button
                  type="button"
                  onClick={() => setAddingValue(true)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                  Add value
                </button>
              ) : (
              <>
              {/* Dismiss sits in the column the `+` opened from, so the row costs no extra width. */}
              <button
                type="button"
                onClick={closeAdd}
                aria-label="Cancel"
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
              <input
                type="text"
                autoFocus
                placeholder="Add a value"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canAdd) {
                    e.preventDefault()
                    addValueMutation.mutate()
                  }
                  if (e.key === 'Escape') closeAdd()
                }}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              <Button
                size="sm"
                className="h-7 shrink-0 px-2.5"
                onClick={() => addValueMutation.mutate()}
                disabled={!canAdd}
                loading={addValueMutation.isPending}
              >
                Add
              </Button>
              </>
              )}
            </li>
          </ul>

          {/* Only while the row is open: the explanation is about the fields, so it has nothing to
              say to someone who is just reading the list. */}
          {addingValue && (
            <p className="mt-2 text-[11px] leading-tight text-muted-foreground">
              {state.values.length === 0
                ? 'The first value becomes the default: what this state is whenever nothing has changed it.'
                : 'Give a value minutes to have it fall back to the default on its own. Leave it empty to hold until something else changes it.'}
            </p>
          )}

          {/* Same icon-only destructive button the type editor and EventDetailModal use. It was an
              outline Button reading "Delete state", which the outline variant renders in the primary
              tint: the one destructive action on the screen looked like its safest one. */}
          <div className="mt-3 flex items-center">
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={deleteStateMutation.isPending}
              aria-label={`Delete ${state.name}`}
              title="Delete state"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
            >
              {deleteStateMutation.isPending
                ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                : <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />}
            </button>
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
    </li>
  )
}
