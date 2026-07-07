"use client"

import { CalendarRange, Inbox, Settings, Target, Zap } from "lucide-react"
import { goals, tierMeta, type View } from "@/lib/planner-data"

const navItems: { id: View; icon: typeof CalendarRange; label: string }[] = [
  { id: "daily", icon: CalendarRange, label: "Daily Plan" },
  { id: "inbox", icon: Inbox, label: "Inbox" },
  { id: "goals", icon: Target, label: "Goals" },
]

export function Sidebar({
  view,
  onViewChange,
}: {
  view: View
  onViewChange: (v: View) => void
}) {
  const focusGoals = goals.filter((g) => g.tier === "focus")

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-background">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Zap className="h-4 w-4" strokeWidth={2.5} />
        </div>
        <span className="text-lg font-semibold tracking-tight text-foreground">Stryde</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3">
        <ul className="flex flex-col gap-1">
          {navItems.map((item) => {
            const active = item.id === view
            return (
              <li key={item.id}>
                <button
                  onClick={() => onViewChange(item.id)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    active
                      ? "bg-muted font-semibold text-foreground"
                      : "font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  <item.icon className="h-[18px] w-[18px]" strokeWidth={2} />
                  {item.label}
                </button>
              </li>
            )
          })}
        </ul>

        {/* Focus goals shortcut */}
        <div className="mt-6 px-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Focus Goals
          </p>
          <ul className="flex flex-col gap-1">
            {focusGoals.map((goal) => (
              <li key={goal.id}>
                <button
                  onClick={() => onViewChange("goals")}
                  className="flex w-full items-center gap-3 rounded-lg py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${tierMeta[goal.tier].dot}`} />
                  <span className="truncate">{goal.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      {/* Bottom */}
      <div className="mt-auto flex flex-col gap-1 border-t border-border px-3 py-4">
        <button className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground">
          <Settings className="h-[18px] w-[18px]" strokeWidth={2} />
          Settings
        </button>
      </div>
    </aside>
  )
}
