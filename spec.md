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

Stryde is built around three primitives: **Activities**, **Goals**, and the **Daily Plan**. Everything else is a view or a rule that operates on these.

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

## Activities and Occurrences

The scheduling primitive is split into two layers:

**Activity** — the definition of a type of work. Created and managed on the Activities page.

| Field | Notes |
|---|---|
| Title | Required |
| Goal | Optional — links to one goal |
| Category | Optional |
| Kind | `activity` (default) or `event` |

**Occurrence** — a scheduled (or floating) instance of an Activity.

| Field | Notes |
|---|---|
| Activity | Required — which Activity this occurrence is of |
| Title | Optional — overrides the Activity title for this instance |
| Start datetime | Optional — absent for floating occurrences; window start when `IsPlanned` |
| End datetime | Optional — window end when `IsPlanned`; deadline/duration end otherwise |
| Is all day | Boolean — marks an all-day occurrence |
| Is planned | Boolean — marks a flexible/windowed occurrence (dashed calendar display, never overdue) |
| Duration minutes | Optional — effort estimate in minutes, applicable to any occurrence type |
| Status | `pending`, `done`, `skipped` |

`effectiveTitle` on the occurrence DTO = `title ?? activity.title`.

Occurrences exist in one of three scheduling states:

### Floating Occurrences

An occurrence with no start datetime, no end datetime, no all-day flag, and `IsPlanned = false` is floating. It appears in its category's list on the Categories page (under a "Floating" group) and is always visible in the Daily Plan suggestion panel's Floating section, from which it can be scheduled. It is not overdue and carries no urgency signal by itself.

### Planned Occurrences

An occurrence with `IsPlanned = true`. The `StartAt`/`EndAt` fields act as window bounds when both are present; `EndAt` alone is a soft due date; `IsAllDay` marks it as a flexible all-day task.

- Planned occurrences appear on the calendar with a dashed diagonal-stripe style spanning their window.
- They are grouped separately in list views (labeled "Planned").
- They are never overdue — `IsPlanned` is a signal that the time is flexible, not a commitment.
- `DurationMinutes` (if set) must be positive and, when both window bounds exist, must not exceed the window length.

### Scheduled Occurrences

An occurrence with a start datetime and `IsPlanned = false` is scheduled. It participates in scheduling, overdue detection, and goal progress.

### Overdue

An occurrence is overdue if it is still pending and `IsPlanned = false` and:
- It has an end datetime and that datetime has passed, **or**
- It has a start datetime (no end) and its day has ended (the day boundary on the following date has passed, in the user's timezone — see Timezone & Day Semantics).

Floating and planned occurrences are never overdue.

### Scheduling

Scheduling an occurrence means setting its start datetime (and optionally end datetime). An occurrence can be rescheduled by updating these fields.

### Creation

Occurrences are created via a modal. Creating an occurrence requires selecting an Activity (or quick-creating one inline).

---

## Categories

A category is a user-defined label with a color and an optional icon, used to group activities that aren't tied to a goal (e.g. "Health", "Admin").

| Field | Notes |
|---|---|
| Name | Required |
| Color | Required — hex color string |
| Icon | Optional — icon key |

The Categories page (`/categories`) lists occurrences per category. Its first nav item is "No category" (`/categories`, the default view), showing only occurrences whose activity has no category; each category is a filterable nav item (`/categories?category={id}`). On desktop the items live in the sidebar under a "Categories" section; on mobile they live in an in-page drawer opened from the page header. Categories are managed inline from those lists (no dedicated management page). Activities carry an optional `CategoryId`.

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
| Size | `tiny`, `small`, `normal`, `big`, `huge` — relative weight of this checkpoint's contribution |
| Target date | Optional |
| Status | `pending`, `reached` |

Checkpoints have no required order — they can be reached in any sequence.

### Progress Model

Progress has two tracks:

**Believed progress** — proportional: `(sum_weights_reached / sum_weights_total) × 100`. Size weights: tiny=1, small=2, normal=3, big=5, huge=8. Returns 0 when no checkpoints exist.

**Actual progress** — derived from completed occurrences linked to this goal. Attribution model is TBD (Open Decision #1).

**Insight** — the delta between believed and actual progress, surfaced as a simple diff and trend.

---

## Daily Plan

The Daily Plan is the primary execution view: a distinct page (`/plan`, the app's index route) focused on *executing* today, as opposed to the Calendar which is for *placing events in time*.

> **Status: shipped in Phase 10.**

### Contents

- **Overdue** — on today's view only: every overdue occurrence regardless of which day it was scheduled for, shown above the agenda with its date. Overdue items scheduled for today appear here instead of in the agenda (same "overdue wins" grouping rule as the Categories page).
- **Today's agenda** — the day's scheduled events as an ordered list (not an hour grid), with one-click done/skip.
- **Recommendations** — the ranked list below, in the middle column (see design.md three-pane layout).
- **Goal health strip** — Focus goals with believed vs actual progress at a glance.

### Navigation

Users can navigate to any day — past or future. Default view is today.

### Day Boundary

The start of a day (when "today" rolls over) is user-configurable in settings. See Timezone & Day Semantics.

### Recommendations (Rule-Based)

The recommendation panel answers: "what should I add to today's schedule?" Floating occurrences are always visible in the panel's "Floating" section regardless of recommendations.

Recommendations are ranked — all tiers surface **activities** (not occurrences):

1. Activities linked to Focus goals
2. Activities linked to Active goals
3. Activities with a day-of-week pattern matching today (>=2 completions on this weekday in the past 6 weeks), where no instance is already on today's schedule — sorted by frequency descending
4. Activities linked to Bench goals (only if tiers 1-3 are empty)

Activities already scheduled today are excluded from all tiers. An activity appears at most once.

**Ranking within tiers:** Tiers 1, 2, and 4 rank by overdueness relative to the activity's own rhythm: days since last completion divided by the median gap between completion days. An activity completed today scores ~0 and sinks (natural cooldown); one past its usual gap floats up. A single completion assumes a weekly cadence; no history scores neutral (1.0). An activity whose typical start time falls inside already-occupied or past time is downranked (score halved). Tier 3 keeps its frequency-descending sort.

**Timing hints:** Each recommendation is enriched with the activity's median duration and most common start time (rounded to 15 min, in user's timezone) from completed history in the **last 90 days** - older habits age out of both timing hints and cadence. When the user schedules from a suggestion, these values pre-fill the modal (start time + computed end time if both are available).

**Free slot awareness:** Activities are only suggested if their typical duration fits at least one free gap on the target day. For today, gaps run from now to end-of-day; for a future day, the whole day is considered; for a past day, slot filtering is skipped. Activities with no duration history are always included.

**LLM expansion slot:** The recommendation engine is designed to be replaceable or augmentable with an LLM-powered planner. Out of scope for v1.

---

## Views

Only these views are in scope for v1:

| View | Purpose |
|---|---|
| Daily Plan | Execution view for a single day: agenda, recommendations, goal health. Index route. |
| Categories | Occurrence lists per category; "No category" is the first item and default view. Entry point for triaging uncategorized work. |
| Calendar | Day/week view of scheduled occurrences. Primary scheduling surface. |
| Goals | Goal list with progress insight per goal. Checkpoint management. |
| Activities | Manage activity definitions: create, edit, delete activities grouped by goal. |
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
