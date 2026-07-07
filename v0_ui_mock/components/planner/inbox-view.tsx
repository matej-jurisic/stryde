"use client"

import { useState } from "react"
import { CalendarPlus, GripVertical, Plus } from "lucide-react"
import { inboxEvents } from "@/lib/planner-data"
import { Checkbox, TopHeader } from "./ui-bits"

export function InboxView() {
  const [items, setItems] = useState(inboxEvents)

  const toggle = (id: string) =>
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)))

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-background">
      <TopHeader title="Inbox" subtitle="Floating events with no scheduled time" />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-2xl">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{items.length} floating events</p>
            <button className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-primary transition-colors hover:border-primary hover:bg-primary/5">
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              New Event
            </button>
          </div>

          <ul className="overflow-hidden rounded-lg border border-border">
            {items.map((item) => (
              <li
                key={item.id}
                className="group flex items-center gap-3 border-b border-border bg-card px-4 py-3 last:border-b-0 hover:bg-muted/40"
              >
                <span className="cursor-grab text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                  <GripVertical className="h-4 w-4" />
                </span>
                <Checkbox status={item.done ? "done" : "todo"} onToggle={() => toggle(item.id)} />
                <span
                  className={`flex-1 text-sm ${item.done ? "text-muted-foreground line-through" : "text-foreground"}`}
                >
                  {item.title}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">{item.duration}</span>
                <button
                  aria-label="Schedule event"
                  className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-primary group-hover:opacity-100"
                >
                  <CalendarPlus className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
