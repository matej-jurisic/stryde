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
| Type | Optional — one user-created scheduling preset. See **Activity Types** below. No type by default, which is the unconstrained profile. Set from the activity modal. |
| Exclude from suggestions | Boolean — when set, the activity never appears in recommendations or as a calendar suggestion. For things logged automatically from outside the app, or anything the user does not want proposed. Toggled per row on the Activities page (which also filters by All / Suggested / Muted) or from the activity's edit modal. |

### Activity Types

A Type declares what an activity *is*, in terms the recommendation engine can act on. It is the
only user-supplied input to suggestion behaviour beyond the mute switch, and exists mainly to give
the engine something to work with before an activity has any completed history — until then every
signal it uses (cadence, habitual time, typical duration) is empty.

**A type is a row the user owns**, not a fixed list the app ships. Every field below is editable, and
a type can be created, renamed, given an icon or deleted like a category. An activity has at most one
type, or none.

**No type is the unconstrained profile**, not a missing value: placed 08:00-21:00, no block floor, no
cap, no cooldown, a 7-day cadence prior. That is why there is no built-in row standing for "general" -
the row would have nothing to say.

New users are seeded with three types, which are ordinary rows with nothing privileged about them.
The table is what they start from, not a canonical list:

| Seeded name | Window | Min block | Cadence prior | Max/day | Cooldown |
|---|---|---|---|---|---|
| General | 08:00-21:00 | - | 7d | - | - |
| Training | 15:00-21:00 | 45 min | 2.5d | 2 | 0.5 |
| Deep work | 09:00-17:00 | 90 min | 2.5d | 2 | - |

Deleting a type set-nulls its activities: they survive with no type, exactly as they do when their
category is deleted.

- **Window** — where a suggestion with no habitual time of its own is placed. The start is a preference: when the window
  has no room the suggestion falls back to an opening *earlier* than the window rather than going
  unplaced. The end is not. Nothing is ever placed past the window end, because that is the point
  where a suggestion of the type stops being plausible - without the bound, a day booked solid until
  20:00 got its workout ghost at 22:45. An activity that cannot be placed before the window end gets
  no slot and appears in the panel without a time. An activity with a habitual start time from
  history ignores its window entirely, because observed behaviour beats a declared preference. A
  window is a preference either way: an activity's **state requirements** are a hard mask applied on
  top of it (see **States**).
- **Min block** — contiguous free time the activity needs regardless of its median duration. This is
  the only setting that can make an activity ineligible: without it a deep work or training activity
  with no history is sized at the 30-minute default and would be offered a 30-minute crack.
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
first training activity suggested spends the allowance for all of them. **Cooldown is per activity.**
That is why the seeded Training type caps at 2 rather than 1: spacing is the cooldown's job, and a cap
of 1 would stop a run and a lift ever being suggested on the same day even when both are due.

A type holds **nothing but scheduling numbers**. It earns its place by having values the engine acts
on differently, not by naming a category of activity. Grouping and labelling are what categories and
goals are for; conditions are what **States** are for. A type never refers to another type.

#### Editing a type

All of it is editable, on the Types tab of the Activities page: name, icon, window, min block and
max/day directly, and cadence prior and cooldown through a dropdown of worded options rather than a
number box. Both of those are fractions of an activity's own completion history rather than clock
values, so a freely typed number has no predictable effect - but leaving them hidden would have made
a user-made type permanently weaker than a built-in one, which is the asymmetry types-as-rows exists
to remove.

| Cadence prior | | Cooldown | |
|---|---|---|---|
| Daily | 1d | As soon as it's due | 0 |
| Every few days | 2.5d | Once you're halfway to due | 0.5 |
| Weekly | 7d | Only when fully due | 1.0 |
| Every couple of weeks | 14d | | |

Nothing may be seeded at a value these options cannot express: a number the editor cannot round-trip
would make a type unreachable by hand. That is why the seeded Deep work carries a 2.5d cadence rather
than the 3d it had while the list was hardcoded.

Editing a type changes suggestions everywhere at once - the engine reads the rows per request, and
the hint copy under the type picker is generated from the row rather than written by hand.

Validation: name required, the window must start before it ends (placement walks candidate starts
forward, so a window wrapping past midnight would match nothing), Min block is 0-480 minutes, Max/day
is 0-24 (0 = unlimited on both), cadence is above 0, and cooldown is 0-1.

Deliberately out of this slice: per-type energy spacing, and any notion of an activity that needs
another person (a coffee or a dinner is not unilaterally schedulable, so no slot the engine picks is
actionable) - mute is the answer for now.

### States

Some activities only make sense when the world is a certain way. A commute home is not a habit with a
rhythm of its own - it exists because you went in, and it is nonsense on a day you did not. Ranking
such an activity by overdueness and placing it at the average of its own completions produces exactly
the two failures this is built to fix: a commute offered at 19:00 on a day nobody went in, and a
commute at 09:00 on a day work started at 08:00.

A **State** is a user-defined dimension of context with an ordered list of possible **values**, one of
which is the default. Managed on the States tab of the Activities page.

| Field | Notes |
|---|---|
| Name | Required. `Location`, `Tired`. |
| Values | Ordered, in creation order. Each has a name and a default flag. How long a value holds is not set here but on the activities that cause it. |

Each activity then declares two things, both optional, both set from the activity modal:

- **Changes** — the state values doing it puts the world into, each with an optional **duration**.
  At most one value per state, which the composite key enforces structurally rather than by a service
  check.
- **Only suggest when** — the values a state must hold. Values listed for one state are **ORed** (the
  state is one *of* them); the groups for different states are **ANDED**.

The whole commute case is then data rather than code:

```
State "Location", values: Home (default), Work
Activity "Commute in"    changes Location -> Work,  only when Location is Home
Activity "Commute home"  changes Location -> Home,  only when Location is Work
Activity "Run"           type Training,             only when Location is Home
State "Tired", values: No (default), Yes
Activity "Leg day"       changes Tired -> Yes for 10 hours
Activity "Hike"          changes Tired -> Yes for 2 days
Activity "Run"           also only when Tired is No
```

#### How a state's value is derived

**Nothing is stored.** A state's value at an instant is read off the schedule: whatever the most
recent state-setting occurrence at or before that instant put it to, unless that value has since
expired, in which case the state is back to its default. This is what stops the two drifting apart -
move a commute and the state moves with it.

- **A setter takes effect at its occurrence's end** (or its start, for a due pin with no end), and a
  duration runs from there. You are at work once the inbound commute *finishes*, and tired once the
  workout is over. The natural setter is therefore a *transition*, which is what a commute or a flight
  is; an office block is a consequence of one, not a transition itself.
- **Only occurrences on the calendar set state:** `pending` or `done`, with a real start. Pending
  counts because it is intent. **Skipped ones do not** - skipping is an explicit decision not to, the
  same reason a skipped block frees its time. **Suggestions never set state**, only real occurrences,
  so the engine cannot bootstrap a day out of its own guesses. **All-day planned occurrences do not
  either** - a setter needs an instant, and "sometime on Thursday" is not one. See Recommendations.
- **Ties break on end time then creation**, so two setters landing on the same minute have a stable
  answer.
- **Lookback is unbounded**, and free: the engine already loads the user's whole occurrence table,
  since SQLite cannot translate a `DateTimeOffset` range `WHERE`.

#### Durations

A change may declare how long the value it sets holds before falling back to the default. This is what
lets a state change back **on its own**, with nothing scheduled to undo it: a workout leaves you tired
for a day, and no phantom "recovered" activity is needed to flip it back. A change with no duration
holds until something else changes it, which is what `Location` wants - you get home because you
scheduled a commute home, not because a timer ran out.

**The duration belongs to the cause, not to the value.** "Tired" has no lifetime of its own: a run
leaves you tired for ten hours and a hike for two days, so the number sits on the activity's change
and two activities can hold one value for different lengths of time. It is entered on the activity
modal, in minutes, hours or days.

- Expiry always returns the state to its **default**. A duration is by definition a temporary
  departure from the default, so a value that ought to decay to some *third* value is a sign the state
  is modelled wrong.
- **A change to the default value cannot carry a duration** - it would decay to itself. Rejected on
  write. Should the default later move onto a value some activity sets *with* a duration, that
  duration simply goes inert (and comes back if the default moves off again): refusing the change, or
  quietly rewriting other activities, would both be worse than a dormant number.
- **A later setter that changes the value replaces the pending expiry** with its own, since the
  departure the old one was counting down is over.
- **A later setter that re-sets the value already in force takes whichever expiry is further out.**
  A second session that afternoon extends the tiredness rather than being cut short by the first one's
  decay - and an easy run the evening after a hike does not cut two days of soreness to ten hours.
- Durations cross the day boundary freely, which day-scoped gating could not express at all. 1-43200
  minutes (30 days); past that a "temporary" value is just the state's normal value.

#### What requirements do to suggestions

Requirements are **suggestion-only**. Nothing here ever blocks scheduling something by hand.

- **The gate.** An activity whose requirements are never satisfied anywhere on the target day is
  dropped from every tier, however overdue it is. This is the only filter keyed off the day's
  *contents* rather than the activity's own history, and the only one that can silence an activity
  that is genuinely due.
- **The mask.** Where requirements *are* satisfied, those stretches are intersected with the day's
  free slots, and every placement rule then chooses within the result. The mask is hard and the window
  stays soft: a habitual start time still beats a type's window, but neither can step outside the mask.
  An activity permitted somewhere on the day but with no room inside the mask gets **no slot** and
  surfaces without a time.
- Nothing about a state is consulted for an activity with no requirements, which is nearly all of
  them.

Flushness comes out of this for free rather than needing a rule: the mask for a commute home opens
when the inbound leg ends and runs to end of day, but the office block occupies its own span, so
free-slot carving puts the first candidate right after work finishes.

**Model each direction as its own activity** ("Commute in", "Commute home"). One activity emitting two
suggestions would break the dedupe set, the per-activity cooldown and the already-scheduled exclusion,
all of which assume one suggestion per activity. Separate legs also give each a habitual time that
means something: a single commute activity has a *bimodal* start-time history, and the engine's modal
start time collapses that to whichever of the two happens to be more frequent. Because each leg
requires the state the *other* leg sets, the pairing falls out of the data: the return leg cannot be
offered until the outbound one is actually on the calendar.

Deleting a state value that an activity still sets or requires is refused with a **409** - silently
dropping those rows would change what gets suggested without saying so. Deleting a whole state is
allowed and cascades, in the same spirit as deleting a category: the activity survives, it just stops
being gated. Deleting the default value promotes the oldest survivor.

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

### Re-pointing

An occurrence's Activity can be changed after creation, from the same picker used to create it. `activityId` on the update request is optional: omitting it leaves the link alone, so a caller that only wants to move a time never has to resend it. The picker is only offered on edit; quick-creating an activity inline stays a creation-time affordance.

The link is only mutable between **activity-kind** activities, and the rule is enforced on both ends:

- An **event** occurrence cannot be moved onto an activity. An event's Activity is a backing row it owns 1:1 - deleting the occurrence deletes it, and editing the event's title edits it in place - so re-pointing would orphan that row. Events have no activity picker in the UI at all; they have a Title field.
- No occurrence can be moved **onto** an event's backing activity, and none can be created on one either. That would give the backing row two occurrences, and deleting either would cascade both away. The activity list endpoint already filters to activity-kind, so the picker cannot offer one; the guard is for direct API use.

The main use is correcting history in bulk after splitting one activity into several, which is exactly what modelling a commute as two directional legs requires - the engine derives a habitual start time per activity, so a leg with no history of its own cannot pick a side.

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

Activities already **scheduled or completed** today are excluded from all tiers - doing something counts for at least as much as planning it. A skipped occurrence does not exclude, matching how skipped time is freed back up for placement. An **all-day planned** occurrence does not exclude either (see below). Activities linked to Bench or Closed goals never appear. Activities flagged "exclude from suggestions" never appear. Activities whose **state requirements** are satisfied nowhere on the target day never appear (see States). An activity appears at most once.

**All-day planned occurrences are invisible to the engine.** `IsPlanned` already says the time is flexible and all-day says there is no time, so together they mean only "sometime that day" - intent with no position on the clock. The user rearranges these between days freely, and that must not change what any day suggests. Such an occurrence therefore does not hold its day (its activity is still suggested), does not count toward a type's `Max/day`, does not block time, and does not set state. The other two combinations still count for all four: **all-day without `IsPlanned`** is a firm commitment to the date, and **planned with times** is a window.

The exception is a *completed* all-day occurrence, which still feeds the cadence figures - it says the activity was done on that day, and dropping that would make something you actually did look overdue. What it cannot feed is the clock: local midnight is not a habitual start time and an exclusive end date is not a span, so an all-day completion contributes to `daysSinceLast` and `medianGapDays` only, whatever its planned flag says. A `DurationMinutes` typed by hand still counts, being an estimate of effort rather than a reading off the calendar.

**Ranking within tiers:** Tiers 1 and 2 rank by overdueness relative to the activity's own rhythm: days since last completion divided by the median gap between completion days. An activity completed today scores ~0 and sinks (natural cooldown); one past its usual gap floats up. A single completion has no derivable gap, so the activity type's cadence prior stands in. An activity with **no completions at all** is measured from its creation date instead, against the same prior - one added today has not had a chance to be due yet, one added three weeks ago with a daily cadence plainly has - and that score is clamped to 3.0, since none of it is actual evidence and an ancient untouched activity would otherwise outrank everything with a real rhythm. An activity whose typical start time falls inside already-occupied or past time is downranked (score halved). Tier 3 keeps its frequency-descending sort.

**Type caps:** Types with a `Max/day` (see Activity Types) stop being suggested once the day holds that many, counting occurrences already scheduled **or completed** for the day alongside suggestions already emitted. Completing the day's two deep work blocks must not reset the cap and invite a third. The cap is applied in rank order and before placement, so a capped-out activity does not consume a slot on its way to being dropped.

**Timing hints:** Each recommendation is enriched with the activity's median duration and most common start time (rounded to 15 min, in user's timezone) from completed history in the **last 90 days** - older habits age out of both timing hints and cadence. When the user schedules from a suggestion, these values pre-fill the modal (start time + computed end time if both are available).

**Free slot awareness:** Activities are only suggested if at least one free gap on the target day fits whichever is larger: their typical duration, or their type's minimum block. For today, gaps run from now to end-of-day; for a future day, the whole day is considered; for a past day, slot filtering is skipped. An activity with neither a duration history nor a type block floor is always included.

Gaps are carved out by occurrences that hold a real span (both a start and an end) on that day. What counts as busy:

- **Pending and done occurrences block.** Done time was spent, and the block is still drawn on the grid, so the engine cannot hand it out again.
- **Skipped occurrences do not block.** Skipping is an explicit decision not to do something, which frees the time back up.
- **Due pins do not block.** A pin (start, no end) is a deadline rather than a commitment to a span, so it never removes time from the day even though the grid draws it 30 minutes tall.
- **Floating occurrences do not block.** They have no time to hold.
- **All-day planned occurrences do not block.** Same reason: a date is not a span. This matters most for a multi-day one, whose `EndAt` is an exclusive end *date* - read as a span it would swallow its first day whole and leave the day with no free time at all.

**Reason signals:** Each recommendation carries the raw signals behind it - `daysSinceLast` (relative to the target day), `medianGapDays`, and `patternCount` (tier 3 weekday matches). The server ships numbers only; the panel composes the user-facing sentence ("6d since last, usually every 2d" / "Usually on Tuesdays, 3x lately"). An activity with no completion history carries no signals and shows no reason line.

**Suggested slot:** Each recommendation carries `suggestedStartAt`, its placement on the target day. An activity with no completion history has no median duration and is placed as if it needed 30 minutes, matching the span the calendar draws for it. It is null on past days (no slots are computed), when nothing fits, when an activity with a habitual time is displaced too far from it, and when an activity's state requirements leave no room on the day (see below).

Placement is **stateful and runs in rank order**, so the highest-ranked activity picks first and each suggestion consumes the room it takes. Without this every suggestion answers the same question against the same empty day and they all land on the first gap that fits.

- **At most two suggestions may cover the same instant.** Two ghosts side by side read as "pick one", which is useful; more than that is unreadable. An activity that cannot be placed within this limit gets a null slot and appears in the panel without a time.
- **State requirements mask the day before any other rule runs.** Every candidate below is drawn from the free slots intersected with the stretches the activity's requirements permit, so no rule can place it outside them. No room inside the mask means a null slot. See **States** above.
- **Habit-anchored activities** (those with a habitual start time) take it when it still fits, ignoring their type's window. When it doesn't, they take the free opening *nearest* to the habit, so a displaced suggestion stays next to its usual time rather than jumping to the start of the day. Ties break toward the earlier slot.
- **Displacement is bounded to 2 hours.** Past that the activity gets a null slot and appears in the panel without a time. An 08:00 gym session offered at 19:00 is the same activity in name only, and the drift is unbounded in the worst case: every opening left in the day can be hours from the habit. Note this bounds the *slot*, not the recommendation - an occupied habitual time is already a downrank (score halved), not a disqualification, and that stands.
- **Unhabituated activities** (no history, or no habitual time) take the first opening inside their type's preferred window. When the window has no room they fall back to the first opening at or after 08:00 local - the day boundary is usually the small hours, and a suggestion at 04:00 is noise - but **never past the window end**. A day with room left only after the window closes yields a null slot rather than a ghost at an hour nobody would take.

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
| Activities | Manage activity definitions: create, edit, delete. Title search, an All / Suggested / Muted filter, and a Goal / Type / Category / States grouping toggle (States groups activities whose "Only suggest when" requirements are the exact same set, and is offered only once a state has values). Rows carry the activity's type (hidden when it has none), category, goal, and subtask count; muting stays a one-tap bulb, edit and delete live in the row's action menu. |
| Insights | Completion stats: headline counts, streak, 14-day chart, category breakdown. |
| Settings | Timezone, day boundary, max Focus goals, activity type tuning, states, appearance, JSON data export, sign out. |

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
| Activity types | Per-type window, minimum block, and max/day. See Activity Types. Each type shows its resolved values, is flagged when customised, and can be reset to the built-in default. |
| States | Create states and their values, and star the default. Expiries live on the activities that cause the change, not here. See States. |
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
