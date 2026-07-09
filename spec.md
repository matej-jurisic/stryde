# Stryde — Product Spec

> Personal operations app. Single user initially, architecture supports multi-user from the start.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Backend | ASP.NET Core |
| Frontend | React + Vite + TypeScript |
| Database | SQLite |
| Deployment | Docker Compose |
| Shell | Web app (PWA shell without PWA features for now; may migrate to Electron) |

---

## Auth

Username + password. Schema and auth layer designed for multi-user from day one — single user is just the initial constraint, not an architectural assumption.

- JWT access token in response body (~15 min expiry)
- Refresh token in httpOnly `Secure` cookie (path `/api/auth`), 6-month lifetime, rotated on every refresh
- All routes except `/api/auth/*` require a valid access token
- On first login, timezone auto-detected from browser and persisted to `UserSettings`

---

## Core Concepts

Stryde is built around three primitives: **Events**, **Goals**, and the **Daily Plan**. Everything else is a view or a rule that operates on these.

---

## Timezone & Day Semantics

All day-bucketing happens **server-side**, in the user's IANA timezone (`User.Timezone`), offset by the configurable day boundary (`UserSettings.DayBoundaryTime`):

- A **day** runs from the boundary time to the next day's boundary time in the user's timezone. With a 04:00 boundary, 02:30 still belongs to the previous day.
- An **event belongs to the day it starts on** (in the user's timezone). Events that cross midnight are not split: the calendar renders them on their start day only, clamped to that day.
- **"Today"** = the day the current instant falls in, per the rules above.
- **Overdue** is computed server-side and exposed as `isOverdue` on the event DTO. The client never re-derives it.
- Floating events have no day and are never overdue.

The shared implementation lives in `Stryde.Core/Common/DayMath.cs`; every feature that reasons about days (recommendations, overdue, future recurrence) must go through it.

---

## Events

An event is the atomic unit of work. Every event has:

| Field | Notes |
|---|---|
| Title | Required |
| Goals | Optional — can link to zero, one, or many goals |
| Start datetime | Optional — absent for floating and windowed events |
| End datetime | Optional — defines duration when combined with start |
| Window start | Optional — start of the flexible scheduling window (windowed events only) |
| Window end | Optional — end of the flexible scheduling window (windowed events only) |
| Window duration | Optional — how long the event is expected to take, in minutes (windowed events only) |
| Repeat rule | Optional — see Repeats below |
| Status | `pending`, `done`, `skipped` |

Events exist in one of three scheduling states:

### Floating Events

An event with no start datetime and no window is floating. It lives in the Inbox and surfaces in Daily Plan recommendations when relevant. It is not overdue and carries no urgency signal by itself.

### Windowed Events

An event with a known duration but no fixed start time, constrained to a time window (`WindowStart`, `WindowEnd`, `WindowDurationMinutes`). The user knows the event will take a certain amount of time but hasn't decided exactly when within the window it will happen.

- Windowed events appear on the calendar spanning their full window, rendered as dashed blocks with a diagonal stripe pattern.
- They do not appear in the Inbox — they already have calendar placement context.
- They are not overdue. The window is a constraint, not a deadline.
- The window and all three window fields must be provided together; they cannot be combined with a start datetime.
- Duration must be positive and must not exceed the length of the window.
- Windowed events are visible to the recommendation engine as candidates for future planning enhancements.

### Scheduled Events

An event with a start datetime is scheduled. It participates in scheduling, overdue detection, and goal progress.

### Overdue

An event is overdue if it is still pending and:
- It has an end datetime and that datetime has passed, **or**
- It has a start datetime (no end) and its day has ended (the day boundary on the following date has passed, in the user's timezone — see Timezone & Day Semantics).

Floating events and windowed events are never overdue.

### Scheduling

Scheduling an event means setting its start datetime (and optionally end datetime). An event can be rescheduled by updating these fields.

### Repeats

Repeat rules use a **virtual-rendering model**: future occurrences are computed from a stored rule and rendered by the calendar for any requested date range — they are never pre-stored in the database. Event lists (Inbox, Daily Plan, recommendations) show only the next upcoming instance.

Supported patterns: daily, weekly on specific days, every N days/weeks/months, monthly on a date.

A rule is stored as a `Pattern` discriminator plus a JSON `Config`:

| Pattern | Config | Example |
|---|---|---|
| `daily` | `{}` | every day |
| `weekly` | `{ "days": [1, 3, 5] }` (ISO weekday, 1 = Monday .. 7 = Sunday) | Mon/Wed/Fri |
| `everyN` | `{ "n": 3, "unit": "days" \| "weeks" \| "months" }` | every 3 weeks |
| `monthly` | `{ "day": 15 }` (clamped to the month's last day) | the 15th monthly |

Behavior on completion: current instance is marked done; calendar continues showing future occurrences derived from the rule.
Behavior on skip: current instance is marked skipped (does not count toward goal progress); calendar continues showing future occurrences.
Behavior on reschedule: datetimes of current instance moved, repeat rule unchanged.
Behavior on delete: user is prompted — delete this instance only, or delete the rule (stops all future occurrences).

### Base Events

A Base Event is a reusable activity template that belongs to a specific goal. It represents a recurring kind of work within that goal.

| Field | Notes |
|---|---|
| Goal | Required — the goal this template belongs to |
| Title | Required |
| Category | Optional |

Base events are created and managed from within the Goals view — there is no standalone Base Events management page. When a goal has base events, they appear as a template list on the goal detail view.

**No auto-creation.** Base events exist only when the user explicitly creates them under a goal. Creating an event with no base event link is valid — that event simply has no template ancestry and will not contribute to tier-3 pattern suggestions.

**Linking on event creation:** When creating or editing an event, if the event is linked to a goal, the user can optionally pick one of that goal's base events as the template. The event's title and category are pre-filled from the template and remain editable after.

Base Events are the grouping unit for the recommendation engine's day-of-week pattern detection (tier 3).

### Creation

Events are created via a modal.

---

## Goals

A goal represents a sustained intention with measurable progress.

| Field | Notes |
|---|---|
| Title | Required |
| Description | Optional |
| Status | `focus`, `active`, `bench`, `closed` |
| Checkpoints | Ordered list of milestones (see below) |

### Focus / Bench

- **Focus** — goal is active and weighted highly in Daily Plan recommendations.
- **Active** — goal is tracked but not prioritized in recommendations.
- **Bench** — goal is deprioritized. Surfaces in recommendations only when nothing more relevant exists.
- **Closed** — goal is archived. Not recommended, not shown in active views.

The maximum number of Focus goals at one time is a user-configurable setting. It is a hard boundary — setting a goal to Focus when the limit is reached is blocked until another is moved out of Focus.

Goal ordering within views is TBD — defined during development.

### Checkpoints

Checkpoints are self-defined milestones that indicate planned progress.

| Field | Notes |
|---|---|
| Title | Required |
| Planned progress | A numeric value representing what fraction of the goal this checkpoint represents (e.g. 25%) |
| Target date | Optional |
| Status | `pending`, `reached` |

Checkpoints have no required order — they can be reached in any sequence.

The planned progress of a goal's checkpoints may not total more than 100%. Creating or editing a checkpoint that would push the total past 100% is rejected with a validation error.

### Progress Model

Progress has two tracks:

**Believed progress** — the sum of planned progress amounts of all reached checkpoints.

**Actual progress** — derived from completed events linked to this goal. Attribution model is TBD (Open Decision #1).

**Insight** — the delta between believed and actual progress, surfaced as a simple diff and trend.

---

## Daily Plan

The Daily Plan is the primary execution view: a distinct page (`/plan`, the app's index route) focused on *executing* today, as opposed to the Calendar which is for *placing events in time*.

> **Status: shipped in Phase 10.**

### Contents

- **Today's agenda** — the day's scheduled events as an ordered list (not an hour grid), with one-click done/skip.
- **Recommendations** — the ranked list below, in the middle column (see design.md three-pane layout).
- **Goal health strip** — Focus goals with believed vs actual progress at a glance.

### Navigation

Users can navigate to any day — past or future. Default view is today.

### Day Boundary

The start of a day (when "today" rolls over) is user-configurable in settings. See Timezone & Day Semantics.

### Recommendations (Rule-Based)

The recommendation panel answers: "what should I add to today's schedule?" It never surfaces events already placed on the calendar — those are visible in the plan and calendar views.

Recommendations are ranked:

1. Floating events linked to Focus goals
2. Floating events linked to Active goals
3. Base Events with a day-of-week pattern matching today (≥2 completions on this weekday in the past 6 weeks), where no instance is already on today's schedule — sorted by frequency descending within the tier
4. Floating events linked to Bench goals (only if tiers 1-3 are empty)

Within each tier, events are sorted by due date ascending (end datetime, falling back to start), then by duration ascending (shorter first); no-duration events sort last. An event appears at most once.

**LLM expansion slot:** The recommendation engine is designed to be replaceable or augmentable with an LLM-powered planner. Out of scope for v1.

---

## Views

Only these views are in scope for v1:

| View | Purpose |
|---|---|
| Daily Plan | Execution view for a single day: agenda, recommendations, goal health. Index route. |
| Inbox | Triage list of all events grouped by state (Overdue, Today, Unscheduled, Upcoming, Completed). Entry point for unscheduled work. |
| Calendar | Day/week view of scheduled events. Primary scheduling surface. |
| Goals | Goal list with progress insight per goal. Checkpoint management. |
| Settings | Timezone, day boundary, max Focus goals, appearance, sign out. |

Additional views (Cockpit, Lab) are deferred — defined during development if needed.

---

## Settings

| Setting | Notes |
|---|---|
| Max Focus goals | Hard limit on simultaneous Focus goals. User-defined. |
| Day boundary | Time at which the day rolls over. |
| Timezone | Set automatically on registration from browser locale. Editable on the Settings page. |
| Theme | Light / dark / system. Client-side preference (localStorage), defaults to system. |

---

## Open Decisions

| # | Decision | Notes |
|---|---|---|
| 1 | Event → goal progress attribution | How much progress does completing one event contribute? Fixed increment, manual per-event amount, or derived from duration? |
| 2 | ~~Recommendation rule weights~~ | **Resolved:** due date asc (end, falling back to start), duration asc, no-duration last; dedupe into highest tier. |
| 3 | LLM recommendation layer | Scope, trigger, and UX for when/how Claude-powered suggestions surface. |

---

## Out of Scope (v1)

- Multi-user features (schema supports it; UI and logic are single-user)
- External integrations (calendar sync, etc.)
- Offline support
- Data export
- Notifications (considered for a later version)
- PWA-specific features (may revisit if staying on web; may migrate to Electron)
- Subtasks
- Someday/maybe bucket (floating events serve this role)
- Cockpit and Lab views
