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

## Events

An event is the atomic unit of work. Every event has:

| Field | Notes |
|---|---|
| Title | Required |
| Goals | Optional — can link to zero, one, or many goals |
| Start datetime | Optional — if absent, the event is floating |
| End datetime | Optional — defines duration when combined with start |
| Repeat rule | Optional — see Repeats below |
| Status | `pending`, `done`, `skipped` |

Duration is derived: `end datetime − start datetime`. There is no separate duration field.

### Floating Events

An event with no start datetime is floating. It lives in the Inbox and surfaces in Daily Plan recommendations when relevant. It is not overdue and carries no urgency signal by itself.

### Standard Events

An event with a start datetime is standard. It participates in scheduling, overdue detection, and goal progress.

### Overdue

An event is overdue if:
- It has an end datetime and that datetime has passed, **or**
- It has a start datetime (no end) and midnight local time on the due date has passed.

### Scheduling

Scheduling an event means setting its start datetime (and optionally end datetime). An event can be rescheduled by updating these fields.

### Repeats

Repeat rules follow a stored rule model (not pre-materialized instances). The next occurrence is generated on completion or skip of the current one.

Supported patterns: daily, weekly on specific days, every N days/weeks/months, monthly on a date.

Behavior on completion: next instance generated immediately.
Behavior on skip: next instance generated, current marked skipped (does not count toward goal progress).
Behavior on reschedule: datetimes of current instance moved, repeat rule unchanged.
Behavior on delete: user is prompted — delete this instance only, or all future instances.

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

### Progress Model

Progress has two tracks:

**Believed progress** — the sum of planned progress amounts of all reached checkpoints.

**Actual progress** — derived from completed events linked to this goal. Attribution model is TBD (Open Decision #1).

**Insight** — the delta between believed and actual progress, surfaced as a simple diff and trend.

---

## Daily Plan

The Daily Plan is the primary execution view. It shows scheduled events as time blocks for a given day, surfaces recommendations, and gives a read on goal health.

### Navigation

Users can navigate to any day — past or future. Default view is today.

### Day Boundary

The start of a day (when "today" rolls over) is user-configurable in settings.

### Layout

Layout and time ribbon behavior will be decided during implementation.

### Recommendations (Rule-Based)

Recommendations are ranked by the following rules in order:

1. Events due today (not yet scheduled)
2. Events overdue (missed due date)
3. Events linked to a Focus goal with lagging actual progress
4. Events linked to Active goals with lagging actual progress
5. Floating events linked to Focus goals
6. Floating events linked to Active goals
7. Floating events linked to Bench goals (only if nothing above exists)

Within each tier, events are sorted by due date ascending, then by duration ascending (shorter first, to fill gaps).

**LLM expansion slot:** The recommendation engine is designed to be replaceable or augmentable with an LLM-powered planner. Out of scope for v1.

---

## Views

Only these views are in scope for v1:

| View | Purpose |
|---|---|
| Inbox | All pending floating events (no start datetime). Entry point for unscheduled work. |
| Calendar | Day/week view of scheduled events. Primary scheduling surface. |
| Goals | Goal list with progress insight per goal. Checkpoint management. |

Additional views (Cockpit, Lab) are deferred — defined during development if needed.

---

## Settings

| Setting | Notes |
|---|---|
| Max Focus goals | Hard limit on simultaneous Focus goals. User-defined. |
| Day boundary | Time at which the day rolls over. |
| Timezone | Set automatically on first open from browser locale. User can override. |

---

## Open Decisions

| # | Decision | Notes |
|---|---|---|
| 1 | Event → goal progress attribution | How much progress does completing one event contribute? Fixed increment, manual per-event amount, or derived from duration? |
| 2 | Recommendation rule weights | Exact tie-breaking within tiers. |
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
