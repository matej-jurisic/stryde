export type Tier = "focus" | "active" | "bench" | "floating"

export const tierMeta: Record<
  Tier,
  { label: string; text: string; border: string; bg: string; dot: string; solid: string }
> = {
  focus: {
    label: "Focus",
    text: "text-goal-focus",
    border: "border-goal-focus",
    bg: "bg-goal-focus/10",
    dot: "bg-goal-focus",
    solid: "bg-goal-focus",
  },
  active: {
    label: "Active",
    text: "text-goal-active",
    border: "border-goal-active",
    bg: "bg-goal-active/10",
    dot: "bg-goal-active",
    solid: "bg-goal-active",
  },
  bench: {
    label: "Bench",
    text: "text-goal-bench",
    border: "border-goal-bench",
    bg: "bg-goal-bench/10",
    dot: "bg-goal-bench",
    solid: "bg-goal-bench",
  },
  floating: {
    label: "Floating",
    text: "text-muted-foreground",
    border: "border-border",
    bg: "bg-muted",
    dot: "bg-muted-foreground",
    solid: "bg-muted-foreground",
  },
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export type Checkpoint = { label: string; done: boolean }

export type Goal = {
  id: string
  name: string
  tier: Tier
  description: string
  believed: number // % — reached checkpoints
  actual: number // % — completed events
  checkpoints: Checkpoint[]
}

export const goals: Goal[] = [
  {
    id: "g1",
    name: "Marathon Prep",
    tier: "focus",
    description: "Train for the fall city marathon.",
    believed: 68,
    actual: 52,
    checkpoints: [
      { label: "Base building — 4 weeks", done: true },
      { label: "Reach 20km long run", done: true },
      { label: "Half-marathon test", done: false },
      { label: "Taper & race", done: false },
    ],
  },
  {
    id: "g2",
    name: "Ship v2 Launch",
    tier: "focus",
    description: "Release the redesigned product.",
    believed: 82,
    actual: 71,
    checkpoints: [
      { label: "Design sign-off", done: true },
      { label: "Feature complete", done: true },
      { label: "Beta feedback", done: true },
      { label: "Public launch", done: false },
    ],
  },
  {
    id: "g3",
    name: "Learn Spanish",
    tier: "active",
    description: "Reach conversational B1 level.",
    believed: 54,
    actual: 41,
    checkpoints: [
      { label: "Complete A1 course", done: true },
      { label: "500 vocabulary words", done: true },
      { label: "First conversation", done: false },
    ],
  },
  {
    id: "g4",
    name: "Read 24 Books",
    tier: "active",
    description: "Two books every month this year.",
    believed: 58,
    actual: 50,
    checkpoints: [
      { label: "6 books", done: true },
      { label: "12 books", done: true },
      { label: "18 books", done: false },
      { label: "24 books", done: false },
    ],
  },
  {
    id: "g5",
    name: "Declutter Home",
    tier: "bench",
    description: "One room at a time, no rush.",
    believed: 24,
    actual: 12,
    checkpoints: [
      { label: "Garage", done: true },
      { label: "Office", done: false },
      { label: "Bedroom", done: false },
    ],
  },
]

export const goalById = (id?: string) => goals.find((g) => g.id === id)

// ---------------------------------------------------------------------------
// Recommendations (middle column, grouped by tier)
// ---------------------------------------------------------------------------

export type Recommendation = {
  id: string
  title: string
  duration: string
  goalId?: string // undefined = floating
  done: boolean
}

export const recommendationGroups: { title: string; items: Recommendation[] }[] = [
  {
    title: "Due Today",
    items: [
      { id: "r1", title: "Long run — 12km", duration: "01:00:00", goalId: "g1", done: false },
      { id: "r2", title: "Fix onboarding bug", duration: "00:45:00", goalId: "g2", done: true },
      { id: "r3", title: "Spanish lesson 4", duration: "00:30:00", goalId: "g3", done: false },
    ],
  },
  {
    title: "Overdue",
    items: [
      { id: "r4", title: "Write launch changelog", duration: "00:40:00", goalId: "g2", done: false },
      { id: "r5", title: "Finish 'Deep Work'", duration: "00:50:00", goalId: "g4", done: false },
    ],
  },
  {
    title: "Focus Goal Tasks",
    items: [
      { id: "r6", title: "Stretch & mobility", duration: "00:20:00", goalId: "g1", done: false },
      { id: "r7", title: "Review beta feedback", duration: "00:35:00", goalId: "g2", done: false },
    ],
  },
  {
    title: "Floating",
    items: [
      { id: "r8", title: "Buy groceries", duration: "00:30:00", done: false },
      { id: "r9", title: "Reply to Sam", duration: "00:15:00", done: true },
    ],
  },
]

// ---------------------------------------------------------------------------
// Scheduled events (single-day execution grid)
// ---------------------------------------------------------------------------

export type EventStatus = "scheduled" | "done" | "skipped"

export type ScheduledEvent = {
  id: string
  title: string
  goalId?: string
  start: number // hour, e.g. 8.5 = 08:30
  end: number
  timeLabel: string
  status: EventStatus
  subtasks?: Checkpoint[]
}

export const dayStart = 7
export const dayEnd = 21

export const scheduledEvents: ScheduledEvent[] = [
  {
    id: "e1",
    title: "Long run — 12km",
    goalId: "g1",
    start: 7,
    end: 8,
    timeLabel: "07:00 - 08:00",
    status: "done",
  },
  {
    id: "e2",
    title: "Stretch & mobility",
    goalId: "g1",
    start: 8.25,
    end: 8.75,
    timeLabel: "08:15 - 08:45",
    status: "done",
  },
  {
    id: "e3",
    title: "Fix onboarding bug",
    goalId: "g2",
    start: 9.5,
    end: 11,
    timeLabel: "09:30 - 11:00",
    status: "scheduled",
    subtasks: [
      { label: "Reproduce issue", done: true },
      { label: "Patch & test", done: false },
    ],
  },
  {
    id: "e4",
    title: "Buy groceries",
    start: 12,
    end: 12.5,
    timeLabel: "12:00 - 12:30",
    status: "scheduled",
  },
  {
    id: "e5",
    title: "Spanish lesson 4",
    goalId: "g3",
    start: 13.5,
    end: 14,
    timeLabel: "13:30 - 14:00",
    status: "scheduled",
  },
  {
    id: "e6",
    title: "Review beta feedback",
    goalId: "g2",
    start: 15,
    end: 16,
    timeLabel: "15:00 - 16:00",
    status: "scheduled",
    subtasks: [
      { label: "Read survey results", done: false },
      { label: "Log top issues", done: false },
    ],
  },
  {
    id: "e7",
    title: "Read 'Deep Work'",
    goalId: "g4",
    start: 17,
    end: 17.75,
    timeLabel: "17:00 - 17:45",
    status: "skipped",
  },
  {
    id: "e8",
    title: "Declutter office desk",
    goalId: "g5",
    start: 19,
    end: 19.5,
    timeLabel: "19:00 - 19:30",
    status: "scheduled",
  },
]

// ---------------------------------------------------------------------------
// Inbox (floating events without a scheduled time)
// ---------------------------------------------------------------------------

export const inboxEvents: Recommendation[] = [
  { id: "i1", title: "Book dentist appointment", duration: "00:15:00", done: false },
  { id: "i2", title: "Renew gym membership", duration: "00:10:00", done: false },
  { id: "i3", title: "Plan weekend trip", duration: "00:45:00", done: false },
  { id: "i4", title: "Organize photo library", duration: "01:00:00", done: true },
  { id: "i5", title: "Water the plants", duration: "00:10:00", done: false },
  { id: "i6", title: "Back up laptop", duration: "00:20:00", done: false },
]

export type View = "daily" | "inbox" | "goals"
