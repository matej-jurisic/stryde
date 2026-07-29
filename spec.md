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
| Kind | `activity` (default) or `event`. Internal split, not user-facing. |
| Type | Scheduling profile — see **Activity Types** below. `general` by default. Set from the activity modal. |
| Exclude from suggestions | Boolean — when set, the activity never appears in recommendations or as a calendar suggestion. For things logged automatically from outside the app, or anything the user does not want proposed. Toggled per row on the Activities page (which also filters by All / Suggested / Muted) or from the activity's edit modal. |

### Activity Types

A Type declares what an activity *is*, in terms the recommendation engine can act on. It is the
only user-supplied input to suggestion behaviour beyond the mute switch, and exists mainly to give
the engine something to work with before an activity has any completed history — until then every
signal it uses (cadence, habitual time, typical duration) is empty.

Presets only: a type is a fixed bundle of five engine settings, not individually editable knobs.

| Type | UI label | Window | Min block | Cadence prior | Max/day | Cooldown |
|---|---|---|---|---|---|---|
| `general` | General | 08:00-21:00 | - | 7d | - | - |
| `habit` | Morning habit | 06:00-12:00 | - | 1d | - | - |
| `eveningHabit` | Evening habit | 18:00-22:00 | - | 1d | - | - |
| `training` | Training | 15:00-21:00 | 45 min | 2.5d | 2 | 0.5 |
| `deepWork` | Deep work | 09:00-17:00 | 90 min | 3d | 2 | - |
| `chore` | Chore | 08:00-21:00 | - | 7d | - | - |
| `admin` | Admin | 15:00-21:00 | - | 7d | - | - |
| `recovery` | Recovery | 12:00-22:00 | - | 2d | 2 | - |

- **Window** — where an *unanchored* suggestion is placed. A preference, not a constraint: when the
  window has no room the suggestion falls back to the first opening after 08:00, as before. An
  activity with a habitual start time from history ignores its window entirely, because observed
  behaviour beats a declared preference.
- **Min block** — contiguous free time the activity needs regardless of its median duration. This is
  the only setting that can make an activity ineligible: without it a `deepWork` or `training`
  activity with no history is sized at the 30-minute default and would be offered a 30-minute crack.
- **Cadence prior** — the assumed gap between completions until history supplies a real median. It
  drives ranking for an activity with one completion (no derivable gap) and for one with none at all.
- **Max/day** — ceiling on suggestions of that type for the target day, counted against what is
  *already scheduled* that day as well as what has been suggested, so scheduling from a suggestion
  consumes the allowance.
- **Cooldown** — how far through its own rhythm an activity must be before it is offered again, as a
  fraction of its gap between completions (0.5 = halfway to due). Everything else here treats
  due-ness as a *ranking* figure only, so an activity on a focus goal was suggested every single day
  however recently it was done, and a rest day was never proposed. Measured **per activity** from its
  own history, never per goal or per type: one session silences that activity alone, which is what
  makes a two-sided split alternate rather than going quiet altogether. Skipped for an activity with
  no completions, whose due-ness comes from its creation date and says nothing about rest.

Note the scope difference between the last two. **Max/day is per type** - one shared counter, so the
first `training` activity suggested spends the allowance for all of them. **Cooldown is per
activity.** That is why `training` caps at 2 rather than 1: spacing is the cooldown's job, and a cap
of 1 would stop a run and a lift ever being suggested on the same day even when both are due.

`habit` and `eveningHabit` are one cadence with two windows rather than one type with a wide window:
placement takes the *first* opening inside the window, so a 06:00-22:00 habit would still land at
dawn. `training` sits between them and `chore` on cadence, because a training split repeats every
few days and neither a 1-day nor a 7-day prior describes that.

Deliberately out of this slice: per-type energy spacing, and surfacing `recovery` more heavily on
dense days. `recovery` currently differs from the other types only in its window, prior, and cap.
Its `Max/day` is per *type*, so unrelated leisure activities filed under it compete for the same two
daily slots. Also absent: any notion of an activity that needs another person (a coffee or a dinner
is not unilaterally schedulable, so no slot the engine picks is actionable) — mute is the answer for
now.

**Occurrence** — a scheduled (or floating) instance of an Activity.

| Field | Notes |
|---|---|
| Activity | Required — which Activity this occurrence is of |
| Title | Optional — overrides the Activity title for this instance |
| Start datetime | Optional — absent for floating occurrences; window start when `IsPlanned` |
| End datetime | Optional — window end when `IsPlanned`; deadline/duration end otherwise |
| Is all day | Boolean — marks an all-day occurrence |
| Is planned | Boolean — marks a flexible/windowed occurrence (dashed calendar display, never overdue); may also be set on a floating occurrence, which routes it to the suggestion panel |
| Duration minutes | Optional — effort estimate in minutes, applicable to any occurrence type |
| Status | `pending`, `done`, `skipped` |

`effectiveTitle` on the occurrence DTO = `title ?? activity.title`.

Occurrences exist in one of three scheduling states:

### Floating Occurrences

An occurrence with no start datetime, no end datetime, and no all-day flag is floating. `IsPlanned` may be set independently and splits where floating occurrences surface on the Daily Plan:

- **Planned floating** (`IsPlanned = true`) — shown in the suggestion panel's Floating section (desktop sidebar and mobile drawer), from which it can be scheduled.
- **Unplanned floating** (`IsPlanned = false`) — shown in the Daily Plan agenda under a "Floating" group (on every day, since it has no day of its own).

The calendar's FLOAT row shows both, planned ones first. On the Categories page a planned floating occurrence groups under "Planned"; an unplanned one under "Floating". A floating occurrence is not overdue and carries no urgency signal by itself.

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

### Skipping with Reschedule

When marking an occurrence skipped, the user may optionally reschedule it: a modal lets them pick a new date (default: next day after the occurrence date). Confirming skips the original and creates a new pending copy with the start/end dates shifted to the chosen date. The rescheduled copy is otherwise identical to the original.

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
| Notes | Optional — freeform markdown text; rendered in GoalDetailPage |
| Status | `focus`, `active`, `bench`, `closed` |
| Checkpoints | Ordered list of milestones (see below) |

### Focus / Bench

- **Focus** — goal is active and weighted highly in Daily Plan recommendations.
- **Active** — goal is tracked but not prioritized in recommendations.
- **Bench** — goal is deprioritized. Activities linked to it are hidden from recommendations and from the calendar float row.
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

### Occurrence Stats

For goals with `Kind = ongoing`, `GoalDto.OccurrenceStats` carries aggregate done/skipped/pending counts across all activities linked to the goal. Displayed as a proportional bar (`OccurrenceBar`) on the Goals page.

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

The recommendation panel answers: "what should I add to today's schedule?" Planned floating occurrences are always visible in the panel's "Floating" section regardless of recommendations, listed **above** the ranked tiers since they are already committed to and only need a time; unplanned floating occurrences live in the Daily Plan agenda instead.

Recommendations are ranked — all tiers surface **activities** (not occurrences):

1. Activities linked to Focus goals
2. Activities linked to Active goals
3. Activities with a day-of-week pattern matching today (>=2 completions on this weekday in the past 6 weeks), where no instance is already on today's schedule — sorted by frequency descending

Activities already scheduled today are excluded from all tiers. Activities linked to Bench or Closed goals never appear. Activities flagged "exclude from suggestions" never appear. An activity appears at most once.

**Ranking within tiers:** Tiers 1 and 2 rank by overdueness relative to the activity's own rhythm: days since last completion divided by the median gap between completion days. An activity completed today scores ~0 and sinks (natural cooldown); one past its usual gap floats up. A single completion has no derivable gap, so the activity type's cadence prior stands in. An activity with **no completions at all** is measured from its creation date instead, against the same prior - one added today has not had a chance to be due yet, one added three weeks ago with a daily cadence plainly has - and that score is clamped to 3.0, since none of it is actual evidence and an ancient untouched activity would otherwise outrank everything with a real rhythm. An activity whose typical start time falls inside already-occupied or past time is downranked (score halved). Tier 3 keeps its frequency-descending sort.

**Type caps:** Types with a `Max/day` (see Activity Types) stop being suggested once the day holds that many, counting occurrences already scheduled for the day alongside suggestions already emitted. The cap is applied in rank order and before placement, so a capped-out activity does not consume a slot on its way to being dropped.

**Timing hints:** Each recommendation is enriched with the activity's median duration and most common start time (rounded to 15 min, in user's timezone) from completed history in the **last 90 days** - older habits age out of both timing hints and cadence. When the user schedules from a suggestion, these values pre-fill the modal (start time + computed end time if both are available).

**Free slot awareness:** Activities are only suggested if at least one free gap on the target day fits whichever is larger: their typical duration, or their type's minimum block. For today, gaps run from now to end-of-day; for a future day, the whole day is considered; for a past day, slot filtering is skipped. An activity with neither a duration history nor a type block floor is always included.

Gaps are carved out by occurrences that hold a real span (both a start and an end) on that day. What counts as busy:

- **Pending and done occurrences block.** Done time was spent, and the block is still drawn on the grid, so the engine cannot hand it out again.
- **Skipped occurrences do not block.** Skipping is an explicit decision not to do something, which frees the time back up.
- **Due pins do not block.** A pin (start, no end) is a deadline rather than a commitment to a span, so it never removes time from the day even though the grid draws it 30 minutes tall.
- **Floating occurrences do not block.** They have no time to hold.

**Reason signals:** Each recommendation carries the raw signals behind it - `daysSinceLast` (relative to the target day), `medianGapDays`, and `patternCount` (tier 3 weekday matches). The server ships numbers only; the panel composes the user-facing sentence ("6d since last, usually every 2d" / "Usually on Tuesdays, 3x lately"). An activity with no completion history carries no signals and shows no reason line.

**Suggested slot:** Each recommendation carries `suggestedStartAt`, its placement on the target day. An activity with no completion history has no median duration and is placed as if it needed 30 minutes, matching the span the calendar draws for it. It is null on past days (no slots are computed) and when nothing fits.

Placement is **stateful and runs in rank order**, so the highest-ranked activity picks first and each suggestion consumes the room it takes. Without this every suggestion answers the same question against the same empty day and they all land on the first gap that fits.

- **At most two suggestions may cover the same instant.** Two ghosts side by side read as "pick one", which is useful; more than that is unreadable. An activity that cannot be placed within this limit gets a null slot and appears in the panel without a time.
- **Anchored activities** (those with a habitual start time) take it when it still fits, ignoring their type's window. When it doesn't, they take the free opening *nearest* to the habit, so a displaced suggestion stays next to its usual time rather than jumping to the start of the day. Ties break toward the earlier slot.
- **Unanchored activities** (no history, or no habitual time) take the first opening inside their type's preferred window. When the window has no room, they fall back to the first opening at or after 08:00 local - the day boundary is usually the small hours, and a suggestion at 04:00 is noise.

Candidate positions are on the quarter hour. When present, the panel offers one-click scheduling at that time, creating the occurrence directly with `endAt` derived from the median duration. The modal path remains available for anything needing adjustment.

**Suggested slots on the calendar:** The Calendar page can draw its suggestions in place. A toggle in the header ("show suggested slots", persisted in `localStorage`) renders each visible day's top suggestions as ghost blocks sitting at their `suggestedStartAt` for the length of their median duration (30 min when there is no duration history). Suggestions are fetched per visible day, so a week view shows where the engine would place work across the whole week; past days produce no slots and therefore no ghosts. Only the top few per day are drawn; the panel stays the complete list. The count is the `Calendar suggestions` setting (1-12, default 6) - a ceiling rather than the main throttle, since placement already spreads suggestions across the day and caps overlap at two. Clicking a ghost opens the event modal pre-filled with that activity and slot, so a suggestion is never committed by accident.

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
| Activities | Manage activity definitions: create, edit, delete. Title search, an All / Suggested / Muted filter, and a Goal / Type / Category grouping toggle. Rows carry the activity's type (hidden when `general`), category, goal, and subtask count; muting stays a one-tap bulb, edit and delete live in the row's action menu. |
| Insights | Completion stats: headline counts, streak, 14-day chart, category breakdown. |
| Settings | Timezone, day boundary, max Focus goals, appearance, JSON data export, sign out. |

Additional views (Cockpit, Lab) are deferred — defined during development if needed.

---

## Insights

Read-only stats over **done occurrences**, computed server-side (`GET /api/insights`) using the user's day context (timezone + day boundary). Occurrences without a `StartAt` (floating) are excluded — they have no day to count on. All windows end on the user's current day, except the unaccounted-time stats (average, largest gaps, unused blocks): today is still in progress, so their window is the N full days before today, and the trend's previous window shifts back accordingly.

| Stat | Rule |
|---|---|
| Done today / last 7 days / last 30 days | Count of done occurrences whose start day falls in the window. |
| Current streak | Consecutive days with at least one completion, counting back from today. A today with no completion yet does not break the streak — it then counts back from yesterday. |
| Daily series | Per-day done counts for the last 14 days. |
| Category breakdown | Done counts per category over the last 30 days; completions of uncategorized activities appear as a "No category" bucket. |
| Avg unaccounted time | Per day: `1440 − sum(durations)` of done occurrences (duration = `EndAt − StartAt`, else `DurationMinutes`), clamped at 0; averaged over "tracked days" (days with at least one timed occurrence starting that day), null when no such day exists. Also computed for the immediately preceding window of the same length, for the trend comparison. |
| Largest gaps | Top 5 contiguous untracked stretches across the window's tracked days. Busy intervals come from all completed timed occurrences (so an overnight occurrence covers the next morning), clamped to each day's boundary-to-boundary span and merged before gaps are read off. Times are local clock strings. |
| Unused blocks | Top 3 maximal runs of consecutive 1-hour slots (aligned to the day boundary) that are fully empty on a strict majority of tracked days, ranked by days-empty (a run's weakest slot) then length. |

**Likely-free profile** (`GET /api/insights/empty-profile`) - powers the calendar overlay of times that usually stay empty. Unlike the stats above, days here are midnight-to-midnight local calendar dates (the grid the calendar renders), not day-boundary days. Over the last 8 full weeks (today excluded), a day is "tracked" when at least one completed timed occurrence overlaps it; per weekday, a 1-hour slot is likely free when it was empty on a strict majority of that weekday's tracked days. Weekdays with fewer than 3 tracked days fall back to the profile over all tracked days. Consecutive free slots merge into ranges, returned as minutes from local midnight with weekday 0 = Sunday. The client renders the ranges as a hatched background on today and future day columns only; unaccounted time is by definition genuinely free time (everything is assumed logged), so the overlay reads "your usual free time", not "missing data".

---

## Settings

| Setting | Notes |
|---|---|
| Max Focus goals | Hard limit on simultaneous Focus goals. User-defined. |
| Day boundary | Time at which the day rolls over. |
| Timezone | Set automatically on registration from browser locale. Editable on the Settings page. |
| Calendar suggestions | How many suggestion ghosts the calendar draws per day (1-12, default 6). |
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
