"use client"

import { Check, Plus } from "lucide-react"
import { goals, tierMeta, type Goal } from "@/lib/planner-data"
import { TopHeader } from "./ui-bits"

function ProgressBar({ goal }: { goal: Goal }) {
  const meta = tierMeta[goal.tier]
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium">
        <span className="text-muted-foreground">Progress</span>
        <span className="text-foreground">
          {goal.actual}% <span className="text-muted-foreground">/ {goal.believed}% expected</span>
        </span>
      </div>
      {/* dual-layered bar */}
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
        {/* believed (muted, striped) */}
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${meta.bg}`}
          style={{ width: `${goal.believed}%` }}
        />
        <div
          className={`absolute inset-y-0 left-0 rounded-full opacity-40 ${meta.solid}`}
          style={{ width: `${goal.believed}%` }}
        />
        {/* actual (solid) */}
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${meta.solid}`}
          style={{ width: `${goal.actual}%` }}
        />
      </div>
    </div>
  )
}

function GoalCard({ goal }: { goal: Goal }) {
  const meta = tierMeta[goal.tier]
  const doneCount = goal.checkpoints.filter((c) => c.done).length

  return (
    <article className="flex flex-col rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-foreground">{goal.name}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">{goal.description}</p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium ${meta.border} ${meta.bg} ${meta.text}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
          {meta.label}
        </span>
      </div>

      <div className="mt-4">
        <ProgressBar goal={goal} />
      </div>

      <div className="mt-5">
        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Checkpoints · {doneCount}/{goal.checkpoints.length}
        </p>
        <ul className="flex flex-col">
          {goal.checkpoints.map((cp, i) => {
            const last = i === goal.checkpoints.length - 1
            return (
              <li key={cp.label} className="flex gap-3">
                {/* timeline */}
                <div className="flex flex-col items-center">
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      cp.done ? `${meta.border} ${meta.solid} text-primary-foreground` : "border-border bg-background"
                    }`}
                  >
                    {cp.done && <Check className="h-2.5 w-2.5" strokeWidth={3.5} />}
                  </span>
                  {!last && <span className="my-0.5 w-px flex-1 bg-border" />}
                </div>
                <span
                  className={`pb-3 text-sm ${cp.done ? "text-muted-foreground line-through" : "text-foreground"}`}
                >
                  {cp.label}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </article>
  )
}

export function GoalsView() {
  const tiers = ["focus", "active", "bench"] as const

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-background">
      <TopHeader title="Goals" subtitle="Your progress across every goal" />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mb-6 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {goals.length} goals · {goals.filter((g) => g.tier === "focus").length} in focus
          </p>
          <button className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90">
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            Save Goal
          </button>
        </div>

        {tiers.map((tier) => {
          const list = goals.filter((g) => g.tier === tier)
          if (list.length === 0) return null
          return (
            <div key={tier} className="mb-8">
              <div className="mb-3 flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${tierMeta[tier].dot}`} />
                <h2 className="text-sm font-semibold text-foreground">{tierMeta[tier].label} Goals</h2>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {list.map((goal) => (
                  <GoalCard key={goal.id} goal={goal} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
