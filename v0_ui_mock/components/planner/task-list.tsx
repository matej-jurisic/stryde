"use client"

import { useState } from "react"
import { Check, MoreHorizontal, Sparkles } from "lucide-react"
import { categoryMeta, taskGroups, type Task } from "@/lib/planner-data"

function Checkbox({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-label={checked ? "Mark as not done" : "Mark as done"}
      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors ${
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background hover:border-primary"
      }`}
    >
      {checked && <Check className="h-3 w-3" strokeWidth={3} />}
    </button>
  )
}

function TaskItem({ task, onToggle }: { task: Task; onToggle: (id: string) => void }) {
  return (
    <li className="group flex items-start gap-3 border-b border-border py-3">
      <div className="pt-0.5">
        <Checkbox checked={task.done} onToggle={() => onToggle(task.id)} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p
            className={`truncate text-sm ${
              task.done ? "text-muted-foreground line-through" : "text-foreground"
            }`}
          >
            {task.title}
          </p>
          <button
            aria-label="Task options"
            className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="font-mono text-[11px] text-muted-foreground">{task.duration}</span>
          <span className="text-muted-foreground">·</span>
          <div className="flex flex-wrap gap-1">
            {task.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </li>
  )
}

export function TaskList() {
  const [groups, setGroups] = useState(taskGroups)

  const toggle = (id: string) => {
    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        tasks: g.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
      })),
    )
  }

  return (
    <section className="flex w-[340px] shrink-0 flex-col border-r border-border bg-background">
      <div className="px-5 py-5">
        <h1 className="text-lg font-semibold text-foreground">Today Activity</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Good morning, Alex — you have 8 tasks today.
        </p>
        <button className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-sm font-medium text-primary transition-colors hover:border-primary hover:bg-primary/5">
          <Sparkles className="h-4 w-4" />
          Plan Your Day with AI
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-6">
        {groups.map((group) => {
          const meta = categoryMeta[group.category]
          return (
            <div key={group.category} className="mb-4">
              <div className="flex items-center gap-2 py-2">
                <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {meta.label}
                </h2>
              </div>
              <ul>
                {group.tasks.map((task) => (
                  <TaskItem key={task.id} task={task} onToggle={toggle} />
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
}
