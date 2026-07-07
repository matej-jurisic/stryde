"use client"

import { GripVertical } from "lucide-react"
import {
  dayEnd,
  dayStart,
  goalById,
  scheduledEvents,
  tierMeta,
  type ScheduledEvent,
} from "@/lib/planner-data"
import { Checkbox, TopHeader } from "./ui-bits"

const HOUR_HEIGHT = 88

function EventBlock({ event }: { event: ScheduledEvent }) {
  const goal = goalById(event.goalId)
  const tier = goal ? goal.tier : "floating"
  const meta = tierMeta[tier]
  const top = (event.start - dayStart) * HOUR_HEIGHT
  const height = (event.end - event.start) * HOUR_HEIGHT
  const faded = event.status === "done" || event.status === "skipped"

  return (
    <div
      className={`absolute inset-x-3 z-10 flex flex-col overflow-hidden rounded-md border bg-background p-2 ${meta.border} ${
        faded ? "opacity-70" : ""
      }`}
      style={{ top: top + 2, height: Math.max(height - 6, 54) }}
    >
      <div className={`pointer-events-none absolute inset-0 ${meta.bg}`} />
      <div className="relative flex items-start gap-1.5">
        <GripVertical className={`h-3.5 w-3.5 shrink-0 cursor-grab ${meta.text} opacity-60`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p
              className={`truncate text-xs font-semibold ${
                event.status === "scheduled" ? "text-foreground" : "text-muted-foreground line-through"
              }`}
            >
              {event.title}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <p className={`text-[11px] font-medium ${meta.text}`}>{event.timeLabel}</p>
            {goal && <span className="text-[11px] text-muted-foreground">· {goal.name}</span>}
          </div>
          {event.subtasks && height > 118 && (
            <ul className="mt-1.5 flex flex-col gap-1">
              {event.subtasks.map((st) => (
                <li key={st.label} className="flex items-center gap-1.5">
                  <Checkbox status={st.done ? "done" : "todo"} size={12} />
                  <span
                    className={`text-[11px] ${st.done ? "text-muted-foreground line-through" : "text-foreground"}`}
                  >
                    {st.label}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

export function Calendar() {
  const hours = Array.from({ length: dayEnd - dayStart + 1 }, (_, i) => dayStart + i)

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-background">
      <TopHeader title="Tuesday, July 7" subtitle="Daily Plan" />

      {/* Legend */}
      <div className="flex items-center gap-4 border-b border-border px-6 py-2.5">
        {(["focus", "active", "bench", "floating"] as const).map((t) => (
          <div key={t} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${tierMeta[t].dot}`} />
            <span className="text-[11px] font-medium text-muted-foreground">{tierMeta[t].label}</span>
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="relative pl-16">
          {/* Hour labels */}
          <div className="absolute left-0 top-0 w-16">
            {hours.map((h) => (
              <div
                key={h}
                className="relative border-b border-border pr-2 text-right"
                style={{ height: HOUR_HEIGHT }}
              >
                <span className="absolute -top-2 right-2 text-[11px] font-medium text-muted-foreground">
                  {String(h).padStart(2, "0")}:00
                </span>
              </div>
            ))}
          </div>

          {/* Single day column */}
          <div className="relative border-l border-border">
            {hours.map((h) => (
              <div key={h} className="border-b border-border" style={{ height: HOUR_HEIGHT }} />
            ))}
            {scheduledEvents.map((e) => (
              <EventBlock key={e.id} event={e} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
