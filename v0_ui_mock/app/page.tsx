"use client"

import { useState } from "react"
import { Sidebar } from "@/components/planner/sidebar"
import { Recommendations } from "@/components/planner/recommendations"
import { Calendar } from "@/components/planner/calendar"
import { GoalsView } from "@/components/planner/goals-view"
import { InboxView } from "@/components/planner/inbox-view"
import type { View } from "@/lib/planner-data"

export default function Page() {
  const [view, setView] = useState<View>("daily")

  return (
    <main className="flex h-screen w-full items-center justify-center bg-canvas p-0 lg:p-4">
      <div className="flex h-full w-full max-w-[1600px] overflow-hidden border border-border bg-background lg:rounded-2xl">
        <Sidebar view={view} onViewChange={setView} />
        {view === "daily" && (
          <>
            <Recommendations />
            <Calendar />
          </>
        )}
        {view === "inbox" && <InboxView />}
        {view === "goals" && <GoalsView />}
      </div>
    </main>
  )
}
