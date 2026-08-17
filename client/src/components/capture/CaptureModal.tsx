import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Pencil, Sparkles } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { EventModal } from '@/components/events/EventModal'
import { llmApi, occurrencesApi, ApiError } from '@/lib/api'
import type { CaptureDraft, CaptureResult } from '@/lib/types'

function formatWhen(draft: CaptureDraft): string {
  if (!draft.startAt) return 'No date - floating'

  const start = new Date(draft.startAt)
  const date = start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  if (draft.isAllDay) return `${date}, all day`

  const z = (n: number) => String(n).padStart(2, '0')
  const time = `${z(start.getHours())}:${z(start.getMinutes())}`
  if (!draft.endAt) return `${date} at ${time}`

  const end = new Date(draft.endAt)
  return `${date}, ${time} - ${z(end.getHours())}:${z(end.getMinutes())}`
}

function formatDuration(ms: number): string {
  const seconds = ms / 1000
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

/**
 * Creates the occurrence a draft describes, through the same endpoints as the editor. Subtasks go in
 * a second pass, sequentially, because neither create endpoint takes them and the rows order by
 * creation time.
 */
async function createFromDraft(draft: CaptureDraft) {
  const when = {
    startAt: draft.startAt,
    endAt: draft.endAt,
    isAllDay: draft.isAllDay,
    isPlanned: false,
    durationMinutes: draft.durationMinutes,
  }

  // A matched activity supplies the title, so the override stays empty - the same split the editor
  // makes when it opens a draft.
  const saved = draft.activityId
    ? await occurrencesApi.create({ activityId: draft.activityId, title: null, ...when })
    : await occurrencesApi.createEvent({ title: draft.title, ...when })

  for (const title of draft.subtasks) await occurrencesApi.createSubtask(saved.id, title)
}

/**
 * Types a note, gets back the entries it describes: one for "gym tomorrow at 7", one per shift for a
 * pasted rota. Each is ticked or unticked, and accepted straight from this list - the editor is there
 * for the ones that need a correction first, not as a tollgate every draft has to pass.
 * <p>
 * The whole design assumes the answer is slow. A local model takes tens of seconds to minutes, so
 * the wait is given a running clock rather than a spinner, and the cost of the call is shown
 * afterwards instead of hidden - it is the number that decides where else this can be used.
 */
export function CaptureModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [result, setResult] = useState<CaptureResult | null>(null)
  // Indices, so nothing has to invent an id for a draft that is not a row anywhere.
  const [selected, setSelected] = useState<Set<number>>(new Set())
  // What has actually been written. A creation run that dies half way must not offer to create the
  // same occurrence a second time.
  const [created, setCreated] = useState<Set<number>>(new Set())
  // The draft currently open in the editor. It owns the interaction while it is up, so this modal
  // steps out of the way rather than stacking behind it.
  const [editing, setEditing] = useState<number | null>(null)
  const [showRaw, setShowRaw] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  const drafts = result?.drafts ?? []

  const parseMutation = useMutation({
    mutationFn: llmApi.capture,
    onSuccess: (r) => {
      setResult(r)
      setSelected(new Set(r.drafts.map((_, i) => i)))
      setCreated(new Set())
    },
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      const done = new Set(created)
      try {
        for (let i = 0; i < drafts.length; i++) {
          if (!selected.has(i) || done.has(i)) continue
          await createFromDraft(drafts[i])
          done.add(i)
        }
      } finally {
        // Whatever got through is real, so it is recorded and the caches refreshed even when the
        // run failed part way.
        setCreated(done)
        qc.invalidateQueries({ queryKey: ['events'] })
        qc.invalidateQueries({ queryKey: ['recommendations'] })
      }
    },
  })

  // A local completion runs long enough that a static spinner reads as a hang. Counting up is the
  // difference between "it is working" and "it is broken".
  useEffect(() => {
    if (!parseMutation.isPending) return
    setElapsed(0)
    const started = Date.now()
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 250)
    return () => clearInterval(id)
  }, [parseMutation.isPending])

  useEffect(() => {
    if (open) {
      setText('')
      setResult(null)
      setSelected(new Set())
      setCreated(new Set())
      setEditing(null)
      setShowRaw(false)
      parseMutation.reset()
      createMutation.reset()
    }
  }, [open])

  // Nothing left that the user asked for: every draft is either created or unticked. Depends on
  // `created` alone, so unticking the last row is not read as being finished with the list.
  useEffect(() => {
    if (created.size === 0) return
    if (drafts.every((_, i) => created.has(i) || !selected.has(i))) onClose()
  }, [created])

  function submit() {
    if (text.trim() && !parseMutation.isPending) parseMutation.mutate(text.trim())
  }

  function toggle(index: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  function retry() {
    setResult(null)
    setSelected(new Set())
    setCreated(new Set())
    parseMutation.reset()
    createMutation.reset()
  }

  const pending = drafts.filter((_, i) => selected.has(i) && !created.has(i)).length
  const busy = createMutation.isPending

  const error =
    parseMutation.error instanceof ApiError ? parseMutation.error.message
    : parseMutation.error ? 'Something went wrong.'
    : createMutation.error instanceof ApiError ? createMutation.error.message
    : createMutation.error ? 'Could not create everything on the list. What is added is marked below.'
    : null

  return (
    <>
      <Modal
        open={open && editing === null}
        onClose={onClose}
        title="Quick capture"
        footer={
          <>
            {/* The cost of the call belongs at the edge of the dialog, not in the reading order
                between the drafts and the buttons that act on them. */}
            {result && (
              <button
                type="button"
                onClick={() => setShowRaw((v) => !v)}
                title={result.diagnostics.model}
                className="mr-auto self-center text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
              >
                {formatDuration(result.diagnostics.totalMs)}
                {result.diagnostics.loadMs > 0 && ` (${formatDuration(result.diagnostics.loadMs)} loading)`}
                {' - '}
                {result.diagnostics.promptTokens} in, {result.diagnostics.outputTokens} out
              </button>
            )}
            <Button variant="ghost" onClick={onClose} disabled={parseMutation.isPending || busy}>
              Close
            </Button>
            {result ? (
              <>
                <Button variant="outline" onClick={retry} disabled={busy}>
                  Try again
                </Button>
                <Button onClick={() => createMutation.mutate()} loading={busy} disabled={pending === 0}>
                  {pending > 1 ? `Add ${pending}` : 'Add'}
                </Button>
              </>
            ) : (
              <Button onClick={submit} loading={parseMutation.isPending} disabled={!text.trim()}>
                {parseMutation.isPending ? `Capturing... ${elapsed}s` : 'Capture'}
              </Button>
            )}
          </>
        }
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit() }}
          placeholder="gym tomorrow at 7, warmup then legs"
          rows={3}
          autoFocus
          disabled={parseMutation.isPending}
          className="resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
        />

        {parseMutation.isPending && (
          <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground">
            Waiting on your model. Local hardware takes a while: this is normal.
          </p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {result && (
          <div className="flex flex-col gap-3">
            {drafts.length > 1 && (
              <p className="text-xs text-muted-foreground">
                {drafts.length} entries. Untick anything you do not want.
              </p>
            )}

            {drafts.map((draft, i) => {
              const isCreated = created.has(i)
              const isSelected = selected.has(i)
              return (
                <div
                  key={i}
                  className={`flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3 transition-opacity ${
                    isCreated || !isSelected ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {/* A single draft has nothing to choose between, so it carries the assistant's
                        mark instead of a checkbox. */}
                    {drafts.length > 1 ? (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isCreated || busy}
                        onChange={() => toggle(i)}
                        aria-label={`Include ${draft.activityTitle ?? draft.title}`}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
                      />
                    ) : (
                      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={2} />
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">
                        {draft.activityTitle ?? draft.title}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{formatWhen(draft)}</p>
                    </div>

                    {isCreated ? (
                      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        <Check className="h-3.5 w-3.5" strokeWidth={2} />
                        Added
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditing(i)}
                        disabled={busy}
                        aria-label="Edit before adding"
                        title="Edit before adding"
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                      >
                        <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                    )}
                  </div>

                  <dl className="flex flex-col gap-1 text-xs">
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-muted-foreground">Activity</dt>
                      <dd className="text-foreground">
                        {draft.activityTitle ?? <span className="text-muted-foreground">New event "{draft.title}"</span>}
                      </dd>
                    </div>
                    {draft.durationMinutes && (
                      <div className="flex gap-2">
                        <dt className="w-20 shrink-0 text-muted-foreground">Duration</dt>
                        <dd className="text-foreground">{draft.durationMinutes} min</dd>
                      </div>
                    )}
                    {draft.subtasks.length > 0 && (
                      <div className="flex gap-2">
                        <dt className="w-20 shrink-0 text-muted-foreground">Subtasks</dt>
                        <dd className="text-foreground">{draft.subtasks.join(', ')}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )
            })}

            {showRaw && (
              <pre className="max-h-40 overflow-auto rounded-lg border border-border bg-background p-2 text-[11px] leading-relaxed text-muted-foreground">
                {result.diagnostics.rawJson}
              </pre>
            )}
          </div>
        )}
      </Modal>

      {/* The draft is read once, by the editor's initial state, so each one needs its own mount.
          `onSaved` is what ticks it off here: `onClose` alone cannot tell a create from a cancel. */}
      {result && editing !== null && (
        <EventModal
          key={`${result.diagnostics.rawJson}-${editing}`}
          open={open}
          onClose={() => setEditing(null)}
          onSaved={() => setCreated((prev) => new Set(prev).add(editing))}
          draft={drafts[editing]}
        />
      )}
    </>
  )
}
