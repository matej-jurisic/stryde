"use client"

import { Bell, Check, ChevronLeft, ChevronRight, X } from "lucide-react"
import type { EventStatus } from "@/lib/planner-data"

export function Checkbox({
  status,
  onToggle,
  size = 18,
}: {
  status: EventStatus | "done" | "todo"
  onToggle?: () => void
  size?: number
}) {
  const done = status === "done"
  const skipped = status === "skipped"
  return (
    <button
      onClick={onToggle}
      aria-label={done ? "Mark as not done" : "Mark as done"}
      style={{ height: size, width: size }}
      className={`flex shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
        done
          ? "border-primary bg-primary text-primary-foreground"
          : skipped
            ? "border-dashed border-muted-foreground text-muted-foreground"
            : "border-border bg-background hover:border-primary"
      }`}
    >
      {done && <Check style={{ height: size * 0.6, width: size * 0.6 }} strokeWidth={3} />}
      {skipped && <X style={{ height: size * 0.6, width: size * 0.6 }} strokeWidth={3} />}
    </button>
  )
}

export function TopHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="flex items-center justify-between border-b border-border px-6 py-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <button
            aria-label="Previous"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            aria-label="Next"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          aria-label="Notifications"
          className="relative rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted"
        >
          <Bell className="h-[18px] w-[18px]" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
        </button>
        <div className="flex items-center gap-2.5 border-l border-border pl-4">
          <div className="text-right">
            <p className="text-sm font-medium leading-tight text-foreground">Alex Rivera</p>
            <p className="text-[11px] leading-tight text-muted-foreground">Pro Plan</p>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            AR
          </div>
        </div>
      </div>
    </header>
  )
}
