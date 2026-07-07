"use client"

import { useState } from "react"
import { GripVertical, Plus } from "lucide-react"
import {
  goalById,
  recommendationGroups,
  tierMeta,
  type Recommendation,
} from "@/lib/planner-data"
import { Checkbox } from "./ui-bits"

function RecItem({ item, onToggle }: { item: Recommendation; onToggle: (id: string) => void }) {
  const goal = goalById(item.goalId)
  const tier = goal ? goal.tier : "floating"
  const meta = tierMeta[tier]
  const tagLabel = goal ? `${meta.label}: ${goal.name}` : "Floating"

  return (
    <li className="group flex items-start gap-3 rounded-lg border border-transparent px-2 py-2.5 transition-colors hover:border-border hover:bg-muted/40">
      <span className="pt-0.5 cursor-grab text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
        <GripVertical className="h-4 w-4" />
      </span>
      <div className="pt-0.5">
        <Checkbox status={item.done ? "done" : "todo"} onToggle={() => onToggle(item.id)} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className={`truncate text-sm ${item.done ? "text-muted-foreground line-through" : "text-foreground"}`}>
            {item.title}
          </p>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{item.duration}</span>
        </div>
        <span
          className={`mt-1.5 inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${meta.border} ${meta.bg} ${meta.text}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
          {tagLabel}
        </span>
      </div>
    </li>
  )
}

export function Recommendations() {
  const [groups, setGroups] = useState(recommendationGroups)

  const toggle = (id: string) => {
    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        items: g.items.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
      })),
    )
  }

  return (
    <section className="flex w-80 shrink-0 flex-col border-r border-border bg-background">
      <div className="px-5 py-5">
        <h1 className="text-lg font-semibold text-foreground">Recommendations</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Drag events onto your day to schedule.</p>
        <button className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-sm font-medium text-primary transition-colors hover:border-primary hover:bg-primary/5">
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          New Event
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-6">
        {groups.map((group) => (
          <div key={group.title} className="mb-4">
            <div className="flex items-center justify-between px-2 py-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.title}
              </h2>
              <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">
                {group.items.length}
              </span>
            </div>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <RecItem key={item.id} item={item} onToggle={toggle} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
