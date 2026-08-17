import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { EventModal } from '@/components/events/EventModal'
import { llmApi, ApiError } from '@/lib/api'
import type { CaptureDraft } from '@/lib/types'

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
 * Types a note, gets a filled-in occurrence form back. The draft is never saved here: it is handed
 * to the ordinary editor, which is what makes a wrong reading cost a keystroke.
 * <p>
 * The whole design assumes the answer is slow. A local model takes tens of seconds to minutes, so
 * the wait is given a running clock rather than a spinner, and the cost of the call is shown
 * afterwards instead of hidden - it is the number that decides where else this can be used.
 */
export function CaptureModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState('')
  const [draft, setDraft] = useState<CaptureDraft | null>(null)
  // Set when the user takes the draft to the editor. The editor then owns the interaction, so this
  // modal steps out of the way rather than stacking behind it.
  const [accepted, setAccepted] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  const mutation = useMutation({
    mutationFn: llmApi.capture,
    onSuccess: setDraft,
  })

  // A local completion runs long enough that a static spinner reads as a hang. Counting up is the
  // difference between "it is working" and "it is broken".
  useEffect(() => {
    if (!mutation.isPending) return
    setElapsed(0)
    const started = Date.now()
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 250)
    return () => clearInterval(id)
  }, [mutation.isPending])

  useEffect(() => {
    if (open) {
      setText('')
      setDraft(null)
      setAccepted(false)
      setShowRaw(false)
      mutation.reset()
    }
  }, [open])

  function submit() {
    if (text.trim() && !mutation.isPending) mutation.mutate(text.trim())
  }

  const error =
    mutation.error instanceof ApiError ? mutation.error.message
    : mutation.error ? 'Something went wrong.'
    : null

  return (
    <>
      <Modal
        open={open && !accepted}
        onClose={onClose}
        title="Quick capture"
        footer={
          <>
            {/* The cost of the call belongs at the edge of the dialog, not in the reading order
                between the draft and the buttons that act on it. */}
            {draft && (
              <button
                type="button"
                onClick={() => setShowRaw((v) => !v)}
                title={draft.diagnostics.model}
                className="mr-auto self-center text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
              >
                {formatDuration(draft.diagnostics.totalMs)}
                {draft.diagnostics.loadMs > 0 && ` (${formatDuration(draft.diagnostics.loadMs)} loading)`}
                {' - '}
                {draft.diagnostics.promptTokens} in, {draft.diagnostics.outputTokens} out
              </button>
            )}
            <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
              Close
            </Button>
            {draft ? (
              <>
                <Button variant="outline" onClick={() => { setDraft(null); mutation.reset() }}>
                  Try again
                </Button>
                <Button onClick={() => setAccepted(true)}>Open in editor</Button>
              </>
            ) : (
              <Button onClick={submit} loading={mutation.isPending} disabled={!text.trim()}>
                {mutation.isPending ? `Capturing... ${elapsed}s` : 'Capture'}
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
          disabled={mutation.isPending}
          className="resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
        />

        {mutation.isPending && (
          <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground">
            Waiting on your model. Local hardware takes a while: this is normal.
          </p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {draft && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3">
              <div className="flex items-start gap-2">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={2} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {draft.activityTitle ?? draft.title}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{formatWhen(draft)}</p>
                </div>
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

            {showRaw && (
              <pre className="max-h-40 overflow-auto rounded-lg border border-border bg-background p-2 text-[11px] leading-relaxed text-muted-foreground">
                {draft.diagnostics.rawJson}
              </pre>
            )}
          </div>
        )}
      </Modal>

      {/* The draft is read once, by the editor's initial state, so a fresh parse needs a fresh mount.
          `open` is threaded through rather than hardcoded: closing the editor closes this whole
          interaction, and the editor's own close button is what reports that. */}
      {draft && accepted && (
        <EventModal
          key={draft.diagnostics.rawJson}
          open={open}
          onClose={onClose}
          draft={draft}
        />
      )}
    </>
  )
}
