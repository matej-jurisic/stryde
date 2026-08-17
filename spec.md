# Stryde — Product Spec

Personal operations app built around three primitives: **Activities**, **Goals**, and the **Daily
Plan**. Single user in practice; the schema, auth layer, and every query are scoped by `UserId`.

This document describes what the app does today. Visual rules live in `design.md`; code navigation
and conventions live in `CLAUDE.md`.

---

## Stack & shells

| Layer | Choice |
|---|---|
| Backend | ASP.NET Core (.NET 10) minimal APIs, EF Core, SQLite |
| Frontend | React 19 + Vite + TypeScript, Tailwind CSS v4, TanStack Query, React Router |
| Tests | xUnit: unit (in-memory SQLite + real services) and integration (`WebApplicationFactory`) |
| Web deployment | Docker Compose; the API serves the built SPA with a fallback route |
| Android | Capacitor wraps the SPA in a native WebView (`dev.stryde.app`), signed APK |

The API is one process: it hosts the endpoints and serves the client. On Android the client cannot
use relative `/api` paths, so a **server URL** is stored in `localStorage` and prepended to every
request; empty means web mode and all URLs stay relative. The field appears on the login, register,
and Settings screens only when running natively.

---

## Auth

Username + password (BCrypt hash). Registration requires a username of at least 3 characters and a
password of at least 8.

- **Access token:** JWT in the response body, ~15 minute expiry, held in memory only (Zustand).
- **Refresh token:** 6-month lifetime, stored as a SHA-256 hash, delivered as an httpOnly `Secure`
  cookie scoped to `/api/auth`, and **rotated on every refresh** (the old row is revoked and points
  at its replacement). Native clients receive the raw token in the body and send it back in an
  `X-Refresh-Token` header, since a WebView origin cannot hold the cookie.
- The client makes one silent refresh attempt on a 401 and retries the request once.
- On mount the app calls `/api/auth/refresh` to restore a session; failure routes to `/login`.
- Every route except `/api/auth/*` requires a valid access token. The user id is read from the `sub`
  claim.
- Registration captures the browser's timezone and **seeds three activity types** (see below).

---

## Timezone & day semantics

All day-bucketing happens **server-side**, in the user's IANA timezone (`User.Timezone`) offset by
the configurable day boundary (`UserSettings.DayBoundaryTime`).

- A **day** runs from the boundary time to the next day's boundary. With a 04:00 boundary, 02:30
  belongs to the previous day.
- An **occurrence belongs to the day it starts on**. Occurrences that cross midnight are not split;
  the calendar draws them on their start day, clamped to it.
- **"Today"** is the day the current instant falls in, by those rules.
- **Overdue** is computed server-side and shipped as `isOverdue` on the occurrence DTO. The client
  never recomputes it. Purely presentational date formatting stays client-side.
- An unknown timezone id resolves to UTC rather than throwing.

The implementation is `Stryde.Core/Common/DayMath.cs`; every feature that reasons about days goes
through it, via a `DayContext` from `UserSettingsService.GetDayContextAsync`.

---

## Activities

An **Activity** is the definition of a piece of work. An **Occurrence** is one instance of it in
time. Activities are managed at `/activities`.

| Field | Notes |
|---|---|
| Title | Required, max 255 characters |
| Goal | Optional, one goal |
| Category | Optional |
| Type | Optional, one user-created scheduling preset. No type is the unconstrained profile. |
| Kind | `activity` or `event`. Internal, never shown. |
| Exclude from suggestions | Boolean. When set, the activity never appears in recommendations or as a calendar ghost. |
| Subtasks | Ordered checklist template, copied onto every new occurrence. |
| Changes | State values doing it puts the world into, each with an optional duration. |
| Only suggest when | State values a state must hold for the activity to be suggested. |

Deleting an activity cascades to its occurrences. Deleting a goal, category, or type set-nulls the
link and leaves the activity alive.

### Kinds: activity vs event

- **`activity`** — a reusable definition. It owns many occurrences and is what `/api/activities`
  lists, what the suggestion engine ranks, and what the activity picker offers.
- **`event`** — a one-off. `POST /api/occurrences/event` creates a backing activity row and its
  single occurrence together; `PUT /api/occurrences/{id}/event` edits both (the event's title *is*
  the activity's title); deleting the occurrence deletes the backing row. Events are excluded from
  the activity list endpoint, so nothing can pick one, and the UI shows a Title field instead of an
  activity picker.

### Subtasks

Two levels, deliberately separate:

- **Activity subtasks** are the template: title only, in creation order, CRUD at
  `/api/activities/{id}/subtasks`. Edited inline on the activity detail page.
- **Occurrence subtasks** are the copy made when the occurrence is created, and carry `IsDone`. They
  can be toggled from the occurrence detail modal, edited individually, or replaced as a full set on
  an occurrence update (id present = keep and rename, id absent = create, missing = delete, whole
  field omitted = leave untouched).

### Activity types

A type declares what an activity *is* in terms the engine can act on. It is the only user-supplied
input to suggestion behaviour besides the mute switch, and exists mainly to give the engine something
to work with before an activity has any completed history.

**A type is a row the user owns.** Every field is editable, and a type can be created, renamed,
re-iconed, or deleted like a category. An activity has at most one type, or none. Types hold
**nothing but scheduling numbers**: no type refers to another type, and conditions belong to States.

**No type is the unconstrained profile**, not a missing value: no window, no block floor, no cap, no
cooldown, a 7-day cadence prior. That is why there is no built-in row standing for "general". It is
genuinely unconstrained - a wide default window would still be a window, and its end a hard limit, so
a typeless activity carries no window at all and is placed wherever the day has room. The one bound
it keeps is the global 08:00 civil-hour floor every activity gets regardless of type.

| Field | Meaning |
|---|---|
| Window (start, end) | Where a suggestion with no habitual time of its own is placed. The start is a preference: with no room inside the window, placement falls back to an opening *earlier* than it. The end is hard - nothing is ever placed past it. |
| Min block | Contiguous free time the activity needs regardless of its median duration. The only setting that can make an activity ineligible. 0-480 minutes, 0 = none. |
| Max/day | Ceiling on suggestions of the type for the target day, counted against what is already scheduled or done that day as well as what has been suggested. 0-24, 0 = unlimited. **Per type**: one shared counter. |
| Cadence prior | Assumed gap between completions until history supplies a real median. Drives ranking for an activity with one completion or none. Above 0, up to 365 days. |
| Cooldown | How far through its own rhythm an activity must be before it is offered again, as a fraction of its own gap between completions (0.5 = halfway to due). 0-1. **Per activity**: one session silences that activity alone, which is what makes a two-sided split alternate. |
| Name, icon | Name required; icon is a lucide component name from a curated 23-icon picker. |

Validation: name required, window start strictly before window end (placement walks candidate starts
forward, so a window wrapping past midnight would match nothing), and the numeric bounds above.

Cadence prior and cooldown are edited as **worded dropdowns**, since both are fractions of an
activity's own history rather than clock values:

| Cadence prior | | Cooldown | |
|---|---|---|---|
| Daily | 1d | As soon as it's due | 0 |
| Every few days | 2.5d | Once you're halfway to due | 0.5 |
| Weekly | 7d | Only when fully due | 1.0 |
| Every couple of weeks | 14d | | |

Nothing may be seeded at a value those options cannot express, or a built-in would be unreachable by
hand. New users get three ordinary rows:

| Seeded name | Window | Min block | Cadence prior | Max/day | Cooldown |
|---|---|---|---|---|---|
| General | 08:00-21:00 | - | 7d | - | - |
| Training | 15:00-21:00 | 45 min | 2.5d | 2 | 0.5 |
| Deep work | 09:00-17:00 | 90 min | 2.5d | 2 | - |

Training caps at 2 rather than 1 because spacing is the cooldown's job: a cap of 1 would stop a run
and a lift being suggested on the same day even when both are due. The engine reads type rows per
request, so editing a type changes suggestions everywhere at once, and the hint copy under the type
picker is generated from the row rather than written by hand.

### States

Some activities only make sense when the world is a certain way. A commute home is not a habit with
a rhythm of its own: it exists because you went in, and it is nonsense on a day you did not.

A **State** is a user-defined dimension of context with an ordered list of possible **values**, one
of which is the default. Managed at `/activities/states`.

| Field | Notes |
|---|---|
| Name | Required. `Location`, `Tired`. |
| Values | Ordered by creation. Each has a name and a default flag. How long a value holds is not set here but on the activities that cause it. |

Each activity then declares two optional things, both from the activity modal:

- **Changes** — the state values doing it puts the world into, each with an optional **duration**.
  At most one value per state, enforced structurally by the `(ActivityId, StateId)` key and checked
  in the service so the error reads in domain terms.
- **Only suggest when** — the values a state must hold. Values listed for one state are **ORed**;
  the groups for different states are **ANDed**.

The same requirement shape is read once more outside the engine, by the unaccounted-time mask in
Settings: see Insights.

A value cannot be deleted while any activity, or the mask, still points at it.

The commute case is then data rather than code:

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
expired, in which case the state is back to its default. That is what stops the two drifting apart -
move a commute and the state moves with it.

- **A setter takes effect at its occurrence's end** (or its start, for a due pin with no end), and a
  duration runs from there. You are at work once the inbound commute *finishes*, and tired once the
  workout is over. The natural setter is a *transition*; an office block is a consequence of one.
- **Only occurrences on the calendar set state:** `pending` or `done`, with a real start. Pending
  counts because it is intent. **Skipped ones do not** - skipping is an explicit decision not to,
  the same reason skipped time frees up. **Suggestions never set state**, so the engine cannot
  bootstrap a day out of its own guesses. **All-day planned occurrences do not either** - a setter
  needs an instant, and "sometime on Thursday" is not one.
- **Ties break on effective time then creation**, so two setters on the same minute have a stable
  answer.
- **Lookback is unbounded**, and free: the engine already loads the user's whole occurrence table.
- A state with no default and nothing set yet satisfies no requirement.

#### Durations

A change may declare how long the value it sets holds before decaying back to the default. This is
what lets a state change back **on its own**, with nothing scheduled to undo it: a workout leaves you
tired for a day, and no phantom "recovered" activity is needed. A change with no duration holds until
something else changes it, which is what `Location` wants.

**The duration belongs to the cause, not to the value.** "Tired" has no lifetime of its own: a run
leaves you tired for ten hours and a hike for two days, so the number sits on the activity's change
and two activities can hold one value for different lengths. It is entered in the activity modal in
minutes, hours, or days.

- Expiry always returns the state to its **default**. A value that ought to decay to some *third*
  value is a sign the state is modelled wrong.
- **A change to the default value cannot carry a duration** - it would decay to itself. Rejected on
  write. If the default later moves onto a value some activity sets *with* a duration, that duration
  goes inert (and returns if the default moves off again).
- **A later setter that changes the value replaces the pending expiry**, since the departure the old
  one was counting down is over.
- **A later setter that re-sets the value already in force takes whichever expiry is further out.** A
  second session extends the tiredness rather than being cut short by the first one's decay. Null
  ("indefinitely") wins that comparison.
- Durations cross the day boundary freely. 1-43200 minutes (30 days); past that a "temporary" value
  is just the state's normal value.

#### Reading a state at an instant

Because a state is a reading of the schedule, any instant can be asked about. **Clicking empty space
on the calendar grid** opens a read-only dialog for that quarter-hour: every state, the value it holds
then, and why - the occurrence that set it and when, plus when the value ends and what it becomes.

- Answers for a **future** instant exactly as for a past one. The grid already shows what is planned;
  this says what that plan implies about the world.
- A value the state simply defaults to names no cause, and neither does one it decayed back to: an
  expiry is nothing anybody scheduled.
- Nothing here is editable. A wrong reading is wrong on the calendar or in some activity's **Changes**,
  and that is where it gets fixed.
- With no states defined the click does nothing, rather than opening an empty dialog.

#### What requirements do to suggestions

Requirements are **suggestion-only**. Nothing here ever blocks scheduling something by hand.

- **The gate.** An activity whose requirements are never satisfied anywhere on the target day is
  dropped from every tier, however overdue it is. This is the only filter keyed off the day's
  *contents* rather than the activity's own history, and the only one that can silence an activity
  that is genuinely due. What "the day's contents" means is the one thing the suggestion mode
  changes: in **chained** mode the suggestions already placed count too. See Recommendations →
  Suggestion mode.
- **The mask.** Where requirements *are* satisfied, those stretches are intersected with the day's
  free slots, and every placement rule chooses within the result. The mask is hard and the window
  stays soft: a habitual start time still beats a type's window, but neither steps outside the mask.
  An activity permitted somewhere on the day but with no room inside the mask gets **no slot** and
  surfaces without a time.
- Nothing about a state is consulted for an activity with no requirements, which is nearly all of
  them. A user with no states costs one cheap query.

Flushness falls out for free: the mask for a commute home opens when the inbound leg ends and runs to
end of day, but the office block occupies its own span, so free-slot carving puts the first candidate
right after work finishes.

**Model each direction as its own activity** ("Commute in", "Commute home"). One activity emitting
two suggestions would break the dedupe set, the per-activity cooldown, and the already-scheduled
exclusion, all of which assume one suggestion per activity. Separate legs also give each a habitual
time that means something: a single commute activity has a *bimodal* start-time history. Because each
leg requires the state the other sets, the pairing falls out of the data - in **direct** mode the
return leg cannot be offered until the outbound one is on the calendar, and in **chained** mode it is
offered behind it, marked with what it follows.

**Invariants.** Exactly one default per state; the first value created is forced to be it. Clearing
the default flag without naming a replacement is refused. Deleting a value an activity still sets or
requires returns **409**. Deleting the default promotes the oldest survivor. Deleting a whole state
cascades to its values, effects, and requirements: the activity survives and stops being gated. Every
value write returns the whole parent state, since an invariant can move the default onto a sibling.

---

## Occurrences

| Field | Notes |
|---|---|
| Activity | Required. Which activity this is an instance of. |
| Title | Optional, overrides the activity title for this instance. Max 255. |
| Start datetime | Absent for floating; window start when `IsPlanned`. |
| End datetime | Window end when `IsPlanned`; deadline or span end otherwise. Must be after start. |
| Is all day | Marks a date-only occurrence. |
| Is planned | Marks a flexible/windowed occurrence (dashed on the calendar, never overdue). May be set on a floating occurrence, which routes it to the suggestion panel. |
| Duration minutes | Effort estimate, valid on any occurrence type. On a planned occurrence with both window bounds it may not exceed the window length. |
| Status | `pending`, `done`, `skipped`. Marking done clears `IsPlanned`. |
| Subtasks | Per-occurrence checklist with `IsDone`, seeded from the activity's template. |

`effectiveTitle` on the DTO is `title ?? activity.title`. The DTO also carries the full activity
(with its category, goal, type, and state links), which is why occurrence lists are invalidated after
an activity write. Legacy `windowStart`/`windowEnd`/`windowDurationMinutes` columns remain on the row
and are honoured by range filtering; nothing in the UI writes them.

### Scheduling states

**Scheduled** — a start datetime and `IsPlanned = false`. Participates in overdue detection, blocks
time for the engine, and is drawn as a solid calendar block.

**Due pin** — a start with no end. A deadline rather than a commitment to a span: the grid draws it
30 minutes tall and pins it in the calendar's sticky Due row, but it never removes time from the day.

**Planned** — `IsPlanned = true`. `StartAt`/`EndAt` act as window bounds when both are present;
`EndAt` alone is a soft due date; `IsAllDay` marks a flexible all-day task. Drawn as a dashed,
diagonally striped block spanning the window, grouped under "Planned" in list views, and never
overdue - the flag says the time is flexible, not that a commitment is missing.

**Floating** — no start, no end, not all-day. `IsPlanned` splits where it surfaces:

- **Planned floating** appears in the suggestion panel's "Floating" section (desktop sidebar and
  mobile drawer), above the ranked tiers, since it is already committed to and only needs a time.
- **Unplanned floating** appears in the Daily Plan's "Floating" group, on every day, since it has no
  day of its own.

The calendar's FLOAT row shows both, planned first. On the Categories page a planned floating
occurrence groups under "Planned" and an unplanned one under "Floating". Floating occurrences are
never overdue. The `floating=true` list filter also drops occurrences whose activity is on a benched
goal.

### Overdue

An occurrence is overdue when it is pending, not planned, has a start, and:

- it has an end datetime that has passed, **or**
- it is all-day and its calendar date is before today, **or**
- it has a start only and its day has ended (the boundary on the following date has passed).

### Creating, editing, scheduling

One modal covers all of it. It creates either an occurrence of an existing activity (activity picker,
with inline quick-create) or a one-off event (title field). Time mode is a three-way choice - **due**
(end only), **scheduled** (start, optional end), **floating** (neither) - with `all day` and
`planned` as independent flags. Scheduling an occurrence means giving it a start; rescheduling means
changing it. From the calendar, blocks can be dragged to move, dragged from the FLOAT or all-day row
into the grid, and resized.

**Skip with reschedule.** Marking an occurrence skipped opens a modal offering a new date, defaulting
to the day after the occurrence's own. Confirming skips the original and creates a pending copy with
the start/end shifted to the chosen date.

**Duplicate.** The occurrence detail modal duplicates into a pre-filled create modal. No backend
support is needed: it is a create with copied fields.

**Re-pointing.** An occurrence's activity can be changed after creation, from the same picker used to
create it. `activityId` on the update request is optional: omitting it leaves the link alone. Only
valid between activity-kind activities, and enforced on both ends - an event occurrence cannot be
moved onto an activity, and nothing can be created on or moved onto an event's backing row (that
would give it two occurrences, and deleting either would cascade both away). The main use is
correcting history in bulk after splitting one activity into several, which is exactly what modelling
a commute as two directional legs requires.

**Edit activity from a block.** The occurrence detail modal opens the parent activity's editor
directly, shown only for activity-kind rows.

---

## Categories

A user-defined label with a colour and an optional icon, for grouping activities that are not tied to
a goal.

| Field | Notes |
|---|---|
| Name | Required |
| Color | Required, `#RRGGBB` |
| Icon | Optional icon key |

Activities carry an optional `CategoryId`; deleting a category set-nulls it. Categories are managed
inline from the sidebar (desktop) or the page's drawer (mobile) - there is no separate management
page. The category's colour drives every occurrence row and calendar block for its activities.

---

## Goals

A sustained intention with measurable progress.

| Field | Notes |
|---|---|
| Title | Required |
| Description | Optional |
| Notes | Optional markdown, rendered on the goal detail page |
| Status | `focus`, `active`, `bench`, `closed` |
| Kind | `milestone` (checkpoint-driven) or `ongoing` (session-driven) |
| Checkpoints | Unordered list of milestones |

### Status

- **Focus** — weighted highest in suggestions (tier 1) and shown on the Daily Plan.
- **Active** — suggested, one tier down.
- **Bench** — deprioritised. Its activities are hidden from suggestions and from the calendar's
  float row.
- **Closed** — archived. Not suggested; shown dimmed in a Closed section.

The number of simultaneous Focus goals is a user setting and a **hard boundary**: promoting a goal
past the limit returns 409 with a message naming it. Goals are listed grouped Focus → Active → Bench
→ Closed, creation order within a group. Deleting a goal removes its checkpoints and set-nulls its
activities.

### Checkpoints

| Field | Notes |
|---|---|
| Title | Required |
| Size | `tiny`, `small`, `normal`, `big`, `huge` — relative weight, not a percentage |
| Target date | Optional |
| Status | `pending`, `reached` |

Checkpoints have no required order and can be reached in any sequence. Progress is
`sum(weight of reached) / sum(weight of all)`, with weights tiny=1, small=2, normal=3, big=5,
huge=8, and 0 when there are no checkpoints. It is computed client-side from the checkpoint list.

### Progress signals

- **Milestone goals** show a progress ring, a weight-proportional composition bar (one segment per
  checkpoint, sized by its weight, filled when reached), and the checkpoints themselves as chips on
  desktop or a checklist on mobile - each toggling reached in place.
- **Ongoing goals** show `OccurrenceStats` (done / skipped / pending counts across every activity
  linked to the goal) as a proportional bar.
- **Every goal** carries `lastOccurrenceAt`, the most recent completion across its activities,
  rendered as "active today" / "3d ago" / "2w since last".

---

## Recommendations

`GET /api/recommendations?date=YYYY-MM-DD&chain=true` (both optional; the date defaults to the user's
current day, `chain` to false) answers: *what should I add to this day's schedule?* Every tier returns
**activities**, never occurrences.

1. Activities on **Focus** goals
2. Activities on **Active** goals
3. Activities with a **weekday pattern**: at least 2 completions on the target weekday within the
   last 6 weeks, sorted by frequency descending

An activity appears at most once, in its highest tier. Dropped from all tiers:

- Activities already **scheduled or done** on the target day - doing something counts for at least as
  much as planning it. A skipped occurrence does not exclude, matching how skipped time frees up.
- Activities on **Bench** or **Closed** goals.
- Activities flagged **exclude from suggestions**.
- Activities whose **state requirements** are satisfied nowhere on the target day (see
  *Suggestion mode* below for what "the target day" contains).
- Activities inside their type's **cooldown** (skipped when there is no completed history, since that
  figure comes from the creation date and says nothing about rest).
- Activities that **fit no free gap**: the gap must hold whichever is larger, the median duration or
  the type's min block. With neither, the activity is always included.

**All-day planned occurrences are invisible to the engine.** `IsPlanned` says the time is flexible
and all-day says there is no time, so together they mean only "sometime that day". Such an occurrence
does not hold its day, does not count toward a type's `Max/day`, does not block time, and does not
set state - the user can rearrange these between days without churning what any day suggests. The
other two combinations still count for all four: **all-day without `IsPlanned`** is a firm date
commitment, and **planned with times** is a window.

A *completed* all-day occurrence still feeds cadence - it says the activity was done that day, and
dropping that would make something you actually did look overdue - but it cannot feed the clock: local
midnight is not a habitual start time and an exclusive end date is not a span. It contributes to
`daysSinceLast` and `medianGapDays` only. A hand-typed `DurationMinutes` still counts, being an
estimate of effort rather than a reading off the calendar.

### Ranking

Tiers 1 and 2 rank by **overdueness relative to the activity's own rhythm**: days since last
completion divided by the median gap between completion days. An activity completed today scores ~0
and sinks (natural cooldown); one past its usual gap floats up. A single completion has no derivable
gap, so the type's cadence prior stands in. An activity with **no completions at all** is measured
from its creation date against the same prior - one added today has not had a chance to be due, one
added three weeks ago with a daily cadence plainly has - clamped to 3.0, since none of it is evidence
and an ancient untouched activity would otherwise outrank everything with a real rhythm. An activity
whose habitual start time falls in occupied or past time is halved. Tier 3 keeps its frequency sort.

**Type caps** apply in rank order and before placement, so a capped-out activity does not consume a
slot on its way to being dropped. The count is seeded with what the day already holds, scheduled or
done: completing the day's two deep work blocks must not invite a third.

### Timing hints and reasons

Stats come from completed history in the **last 90 days**; older habits age out of both timing hints
and cadence.

- `typicalDurationMinutes` — median duration (span when both timestamps exist, else the typed
  estimate).
- `typicalStartTime` — the activity's habitual start, in the user's timezone, computed over timed
  completions only. Every observed start is tried as the centre of a ±20 minute window, the fullest
  window wins (ties to the earliest), and the answer is that group's mean to the nearest five minutes.
  Start times are measured from the **day boundary**, not midnight, so a 23:50 session and a 00:10 one
  are the ten minutes apart they feel like rather than opposite ends of the clock.
  A group must hold **at least two completions and at least 40% of them** to count as habitual;
  below that the activity simply has none. This is a threshold rather than a best guess because a
  habitual time is not only displayed - it overrides the activity type's preferred window during
  placement, and can leave a suggestion with no time at all when that hour is busy. Two completions
  out of six is the most common start time without being a habit.
- `daysSinceLast`, `medianGapDays`, `patternCount` — the raw "why" signals. The server ships numbers
  only; the panel composes the sentence ("6d since last, usually every 2d" / "Usually on Tuesdays,
  3x lately"). An activity with no history carries no signals and shows no reason line.

Scheduling from a suggestion pre-fills the modal with the start time and a computed end.

### Free slots

For today, gaps run from now to end of day; for a future day, the whole day; for a past day, slot
computation is skipped entirely and every suggestion has a null slot. Gaps are carved out by
occurrences holding a real span (both a start and an end) on that day:

- **Pending and done occurrences block.** Done time was spent and the block is still drawn.
- **Skipped occurrences do not block** - the time frees up.
- **Due pins do not block** - a deadline is not a commitment to a span.
- **Floating occurrences do not block** - they have no time to hold.
- **All-day planned occurrences do not block** - a date is not a span. This matters most for a
  multi-day one, whose `EndAt` is an exclusive end *date*: read as a span it would swallow its first
  day whole.

### Placement

`suggestedStartAt` is the activity's slot on the target day, on the quarter hour. Placement is
**stateful**, so each suggestion consumes the room it takes - without that, every suggestion answers
the same question against the same empty day and they all land on the first gap that fits.

**Placement order is not rank order.** Activities with a habitual start time are placed first, and
ranking decides the order only within that split (and the order of the returned list, and the order
type caps are consumed in). A habitual time is evidence of a claim on a particular hour; an activity
without one has only the 08:00 fallback floor, which is a last resort rather than a preference.
Placed in rank order, two habitless suggestions fill the concurrency cap at 08:00 and push an
activity that has genuinely been started at 08:00 for months off its own hour.

- **State requirements mask the day before any other rule runs.** Every candidate is drawn from the
  free slots intersected with the permitted stretches.
- **A suggestion may not revoke a value the day already needs.** An occurrence on the calendar
  requires its states for the whole of its span, so a suggestion whose effect would take one of them
  out of a value it needs cannot start before that occurrence ends. Otherwise a commute to work,
  habitually a 07:00 thing, is proposed for 07:00 on a day whose 08:00 to 16:00 is a work-from-home
  block that only makes sense at home. A committed occurrence's requirements are a claim on the day,
  not just a condition on whether it may be suggested. Same set of occurrences that blocks time, so
  a skipped, floating or all-day-planned one holds no states either.
- **At most two suggestions may cover the same instant.** Two ghosts side by side read as "pick one";
  more than that is unreadable.
- **Habit-anchored activities** (those with a habitual start time) take it when it still fits,
  ignoring their type's window - observed behaviour beats a declared preference. When it is taken
  they take the free opening *nearest* the habit, ties breaking earlier.
- **Displacement is bounded to 2 hours.** Past that the activity gets no slot. An 08:00 gym session
  offered at 19:00 is the same activity in name only. This bounds the *slot*, not the recommendation:
  an occupied habitual time is a downrank, not a disqualification.
- **Unhabituated activities** take the first opening inside their type's window; with no room there,
  the first opening at or after 08:00 local (the day boundary is usually the small hours) but **never
  past the window end**. A day with room left only after the window closes yields no slot.
  A **typeless** activity has no window, so this reduces to the first opening at or after 08:00 with
  no ceiling but the end of the day.
- An activity with no completion history is sized at 30 minutes, matching the span the calendar draws
  for it.

The slot is null on past days, when nothing fits, when a habit-anchored activity is displaced too
far, and when state requirements leave no room. The recommendation still surfaces, without a time.

### Suggestion mode

A state is read off the schedule, and a suggestion is not on the schedule. That leaves two honest
readings of a day, and the user picks which one they are looking at. The mode is per device
(`localStorage`), not per account, and travels as `chain` on the request, so both readings of a day
cache side by side and flipping between them costs nothing after the first look.

- **Direct** (default) measures every requirement against the day as it actually stands. On a day
  with nothing scheduled, only activities whose requirements hold from the day's opening values are
  suggested at all: the trip home is impossible, because the trip in is still only a suggestion.
- **Chained** lets each placed suggestion set its states as though it had happened, at the end of the
  slot it was given - the same instant a real occurrence would fire at. The suggestions this unlocks
  carry `unlockedBy`, the titles of the ones they are standing on. A whole ordinary day can be
  proposed from an empty one: commute in at 08:00, work at 09:00, commute home at 17:00.

Chained mode widens what a requirement is measured against; it is **not** an override. An activity
requiring a value nothing produces is still dropped, per-day type caps and cooldowns still apply, and
every slot still comes from the permitted stretches.

Two rules keep a chained day coherent, because placement is greedy and a state change is not
symmetric with the things that depend on it:

- **A state change waits for what still needs the value.** The placement rule above, extended from
  the day's committed occurrences to the suggestions placed above this one: a suggestion whose effect
  would take a state out of a value an *already-placed* suggestion requires cannot start before that
  suggestion ends. Without it, a trip home with no habitual hour takes the first opening its own
  requirement allows - the moment the trip in ends - and closes the working day it is meant to end,
  which then fits nowhere and vanishes from the list. Only *placed* suggestions count: waiting for
  every pending one would push the commute past the whole day it makes possible.
- **A candidate leaves the queue only when it is actually placed.** Finding no room is not a verdict,
  because a later leg can put the state back: the activities that need to be at home get their slot
  once the trip home reopens the evening. The scan repeats until a full pass places nothing, and
  whatever is left surfaces without a time or is dropped, exactly as in direct mode.

A suggestion reached late can still be overtaken by a subsequent fold; when that happens it keeps its
place in the list and loses its time, the same answer the engine gives for a day with no room left.

`unlockedBy` is null for anything that would have been suggested anyway, which is what lets the UI
tell an opening you can take now from a conditional one. It names only suggestions that put a state
into a value this activity **accepts** - never one that took a state out of such a value, which is a
suggestion it is blocked by rather than standing on.

### Where suggestions appear

- **Suggestions panel** — a 320px desktop column on the Daily Plan and Calendar pages, and a mobile
  drawer. Planned floating occurrences first, then the ranked tiers ("Focus Goals", "Active Goals",
  "Based on Your Habits") with counts. Each row shows title, effort or timing hint, reason line, and
  goal badge. When a slot exists the action is a `+ HH:mm` pill that creates the occurrence at that
  time with no modal, deriving `endAt` from the median duration; otherwise it opens the modal. The
  panel targets the viewed day, and the header names it ("today", "tomorrow", "Tue, Jul 21"). The
  header also holds the **suggestion mode** toggle, which moves the calendar's ghosts too - it is one
  setting, read from the same place by both. A chained row names what it follows ("After work
  commute") above its reason line.
- **Calendar ghosts** — a header toggle (persisted in `localStorage`) draws each visible day's top
  suggestions as dotted blocks at their slot for the length of their median duration, fetched per
  visible day so a week view shows placement across the whole week. The count per day is the
  `Calendar suggestions` setting (1-12, default 6), a ceiling rather than the main throttle since
  placement already spreads suggestions and caps overlap at two. Clicking a ghost opens the modal
  pre-filled rather than creating anything. A **chained** ghost is drawn one step fainter, dashed
  rather than dotted, with a link icon in place of the sparkle: there is no room on a 20px block for
  words, and it is conditional on another ghost the user may not take.

### Activity history dialog

Every suggestion can answer "have I actually been doing this" without leaving the day being planned:
a panel row has a history icon, and a calendar ghost opens the same dialog on right-click or a hold
(plain click stays scheduling, which is the common case). It is read-only. It shows last done,
cadence, usual time and usual length, an eight-week grid of one cell per day laid out as a calendar
(weekday columns, week rows), and the ten most
recent occurrences with their status, in a box that scrolls rather than growing the dialog. The cadence figures are the ones the engine already computed
for that recommendation, so the dialog and the row's reason line can never disagree; opened from a
floating occurrence, which has no recommendation behind it, those two tiles fall back to the gap
between the last two completions or read `Unknown`. `Open activity` leads to the full detail page.

---

## Views

| Route | Purpose |
|---|---|
| `/plan` | Daily Plan: the execution view for one day. Index route. |
| `/calendar` | Day / 3-day / week grid. The primary scheduling surface. |
| `/categories` | Occurrence lists per category, plus "Active" and "No category". |
| `/goals`, `/goals/:id` | Goal list with progress, and per-goal detail with notes and checkpoints. |
| `/activities`, `/activities/:id` | Activity list and detail (subtasks, occurrence history). |
| `/activities/types` | Activity type admin. |
| `/activities/states` | State admin. |
| `/insights` | Time and unaccounted-time stats. |
| `/settings` | Preferences, data export, sign out. |

`/plan-old` and `/goals-old` keep the previous Plan and Goals layouts routed. `/inbox` redirects to
`/categories`. The three activity routes are one screen in three tabs; their static segments outrank
`/activities/:id`. Types and states live there rather than in Settings because they are user
vocabulary, not app preferences.

Navigation: a 240px desktop sidebar (Daily Plan, Calendar, Goals, Activities, Insights, then the
category list with inline add/edit/delete, and Settings pinned at the bottom); on mobile a 5-slot
bottom bar (Plan, Categories, Calendar, Goals) plus a "More" sheet holding Activities, Insights, and
Settings. Nav items are not `end`-matched, so drilling into a goal, activity, or tab keeps the parent
item lit.

### Daily Plan

The execution view: what to do now, as opposed to the calendar's "where does this go in time".

- **Briefing hero** — completion ring for the day, time-of-day greeting, "N things left", and counts
  for done, left, planned minutes, and overdue.
- **Focus goals** — one chip per focus goal: title, last-session recency, and either its milestone
  percentage or its ongoing occurrence bar.
- **Overdue** — on today's view only, every overdue occurrence regardless of the day it was
  scheduled for, with its date, above the agenda and not in it. One button moves the whole set to
  tomorrow, preserving each clock time.
- **Timeline agenda** — the day's timed occurrences as a spine with a time gutter, split by a live
  **now** marker into past and upcoming, with relative labels ("now", "in 40m") on today. Rows carry
  a one-tap done checkbox, a skip action, and an action menu.
- **Planned** and **Floating** sections below the agenda.
- Day navigation (prev / next / today / date picker) using the same boundary semantics as the
  calendar, and the suggestions panel in the middle column (a drawer on mobile).

### Calendar

Day, 3-day, and week views (choice persisted), with prev/next, jump-to-today, and a date picker.

- Scheduled occurrences as solid blocks, planned ones dashed and striped, suggestion ghosts dotted.
  All of them are packed in one pass, so an overlap renders side by side with real events keeping the
  leftmost columns; every block in a cluster of transitively-overlapping spans shares one width.
- A sticky header with an **all-day row** and a **FLOAT row**; occurrences can be dragged between
  those rows, from a row into the grid (which schedules them), and between day columns.
- Drag-to-create on empty grid, drag-to-move and resize on existing blocks, snapping to 15 minutes.
- A sticky **Due** row keeps due pins and overdue items visible while scrolling.
- Adjustable slot height (zoom controls and pinch, persisted) and a **likely-free overlay**: a
  hatched background on today and future columns marking the hours that usually stay empty on that
  weekday.
- Clicking a block opens the occurrence detail modal; clicking a ghost opens a pre-filled create
  modal. Clicking (or tapping) **empty** grid opens the state snapshot for that quarter-hour - see
  States → Reading a state at an instant. Creating still takes a drag, or a long press on touch, so
  the cheaper gesture answers rather than writes.
- On touch a **tap** is whatever the browser calls a tap: a finger that scrolls, swipes to another day,
  pinches to zoom or holds long enough to create opens nothing.

### Categories

Three kinds of view over the same occurrence list: **Active** (`?all=true`, every pending occurrence
across all categories), **No category** (the default: occurrences whose activity has no category),
and one per category (`?category={id}`). Rows group into Overdue → Today → Planned → Upcoming →
Floating → Completed/Skipped, with overdue winning over the day grouping.

### Activities

Title search, an All / Suggested / Muted filter, and a grouping toggle over **Goal / Type / Category
/ States / None** (persisted in `localStorage`). The States grouping buckets activities whose "Only
suggest when" requirement sets are identical, labelled the way the engine reads them ("Location: Home
or Work, Tired: No"), and is offered only once a state has values. Sections collapse and carry
counts; rows sort by title within a section.

Each row leads with its type tile, then title and a meta line dropping whatever the section header
already says, a mute bulb (optimistic, so the list does not reshuffle while flipping several), and an
action menu. **Multi-select mode** turns the tiles into checkboxes and the row actions into a bottom
bar: mute, unmute, assign, delete, with per-section select-all. Bulk assign sets goal, category, and
type across the selection, each field defaulting to "keep current"; it fans out over the single-item
PUT, resending unchanged fields.

The **types** tab is an accordion per type over the full CRUD, with the four numeric knobs 4-across
and the two worded dropdowns side by side. The **states** tab is an accordion per state with an
inline value list, a star marking the default, and an add row that shares the list's columns.

---

## Insights

Read-only stats over **done occurrences**, computed server-side (`GET /api/insights?period=N`, 7 or
30 days, the page defaults to 7) in the user's day context. Occurrences with no `StartAt` are
excluded - they have no day to count on.

| Stat | Rule |
|---|---|
| Time by activity | Per activity over the window: summed minutes and count, from occurrences with both timestamps and positive elapsed time. Sorted by time. Bars in the activity's category colour. |
| Time by category | Same set grouped by the activity's category; uncategorized completions form a "No category" bucket. |
| Avg unaccounted time | Per day: the counted minutes with nothing logged in them, averaged over "tracked days". Null when no such day exists. Also computed for the immediately preceding window of the same length, for the trend line. |
| Largest gaps | Top 5 contiguous empty stretches across tracked days. Times are local clock strings. |
| Unused blocks | Top 3 maximal runs of consecutive 1-hour slots (aligned to the day boundary) fully empty on a strict majority of tracked days, ranked by days-empty (the run's weakest slot) then length. |

All three read one measurement at different resolutions. Per tracked day - a day at least one timed
completed occurrence starts on - busy spans come from **all** completed timed occurrences (duration =
`EndAt − StartAt`, else `DurationMinutes`), so an overnight one covers the next morning; they are
clamped to the day's boundary-to-boundary span, merged, and what is left over is that day's empty
stretches.

The unaccounted-time stats end on the day **before** today: today is still in progress, and its
remaining hours would read as unaccounted. The previous window shifts back accordingly.

**Unaccounted-time mask.** A setting (Settings → Insights) names state values that make time count at
all: "Location: Home or Work", read like an activity's requirements - ORed within a state, ANDed
across states. Stretches the mask excludes are folded in with the busy spans, so they vanish from all
three stats at once: a week away is not ten empty evenings, because those hours were never the user's
to spend. A tracked day the mask lets nothing through is dropped from the average entirely rather than
scored as zero unaccounted. With no mask set - the default - the whole day counts and the state
machinery is skipped.

**Likely-free profile** (`GET /api/insights/empty-profile`) powers the calendar overlay. Days here
are midnight-to-midnight local calendar dates, not boundary days, because that is the grid the
calendar renders. Over the last 8 full weeks (today excluded), a day is tracked when at least one
completed timed occurrence overlaps it; per weekday, a 1-hour slot is likely free when it was empty
on a strict majority of that weekday's tracked days. Weekdays with fewer than 3 tracked days fall
back to the profile over all tracked days. Consecutive free slots merge into ranges, returned as
minutes from local midnight with weekday 0 = Sunday. The client renders them on today and future
columns only, and reads them as "your usual free time" rather than "missing data": unaccounted time
is genuinely free time, since everything is assumed logged.

---

## Settings

| Setting | Notes |
|---|---|
| Timezone | Captured from the browser on registration; editable here. |
| Day start | The time the day rolls over. |
| Max focus goals | Hard limit on simultaneous Focus goals, 1-20. |
| Calendar suggestions | How many suggestion ghosts the calendar draws per day, 1-12, default 6. |
| Unaccounted time | State values that make time count towards the insights stats. Hidden until a state has values; empty means the whole day counts. See Insights → unaccounted-time mask. |
| Assistant | Points the app at a local model. See Assistant below. |
| Theme | Light / dark / system. Client-side preference in `localStorage`, defaults to system. |
| Server URL | Native shells only: where the app points its API calls. |
| Export data | Downloads `stryde-export-<date>.md`. |
| Account | Username and sign out. |

Settings holds preferences only. Activity types and states are user vocabulary and live on the
Activities page.

**Data export** (`GET /api/export`) is one Markdown document, `text/markdown`, meant to be handed to
a person or an LLM to explain how the app is being used. Sections in order: header, a glossary of the
app's own words, at-a-glance counts with occurrences per month, settings, activity types, states,
categories, goals with checkpoints, activities grouped by category, and the full occurrence history
newest day first.

It is prose, not a data format. There is no import path, so it optimises for reading:

- **No ids.** Everything references everything else by name.
- **Every stored number is spelled out** in the words the UI uses for it: a type's window, block,
  cap, cadence and cooldown become sentences, and 0 becomes "no cap" rather than vanishing.
- **All instants are local** to the user's timezone on a 24h clock.
- **Event-kind activities are not listed** among activities - they are backing rows for one-off
  occurrences and appear only in the history, tagged as such.
- **An occurrence's `CreatedAt` prints only when it disagrees with its own day**, where it says
  something (planned ahead, or written up later) rather than restating the heading.
- Cross-references go both ways: a type lists the activities using it, a state lists what sets it
  and what requires it, a goal lists the activities serving it.

---

## Assistant

An optional layer over a model the user runs themselves, on their own network. Off by default, and
an account that never switches it on never pays for any of it: no calls, no waiting, and no controls
on screen.

The server address and model are **settings, not deployment configuration**, because they are a
moving target the user re-points by hand - a different box, a different tag pulled this week.

| Setting | Notes |
|---|---|
| Enabled | Master switch. Off, nothing calls out. |
| Server address | Root of the Ollama server, e.g. `http://ollama:11434`. Must be a full http(s) URL. |
| Model | The tag as Ollama knows it, e.g. `gemma3:27b`. |
| Timeout | Seconds to wait, 5-900, default 180. A large model on a CPU answers in minutes. |
| Disable thinking | Sends `think: false`. Reasoning tokens are latency spent on output nobody reads. Off by default: a model with no thinking mode rejects the flag. |

Turning the assistant on without a server address and a model is refused at save time. Every
assistant field follows the same null-means-untouched contract as the unaccounted-time mask, so a
write that does not mention them cannot switch the feature off; `""` clears one of the two strings.

**Test connection** (`GET /api/llm/status`) lists what the server has pulled and says whether the
configured model is among them. It generates nothing, so it answers immediately or not at all - which
is the point: it separates "cannot reach the server" from "the model is slow".

Anything the assistant cannot do is `Unavailable` → **503**, not an error. Unreachable server, model
not pulled, timeout, unusable reply: all of them mean the feature is not there right now, and every
caller is expected to carry on without it.

### Quick capture

`POST /api/llm/capture` takes typed English and returns a **list of drafts** - filled-in occurrence
forms. It writes nothing. The user ticks what they want and adds it from the capture dialog, or opens
one in the ordinary editor first; either way creation goes through the same validation and the same
endpoints as a form filled in by hand. A wrong reading therefore costs a keystroke, never a bad
calendar entry.

**A note is not one entry.** "Work and both commutes tomorrow" is three things on the calendar, and a
pasted rota is one per shift, so the answer is always a list - a note about a single thing simply
returns a list of one, and nothing downstream has a one-draft path. The note may be up to 4000
characters, and at most **30 entries** come back from one: a model that has started repeating itself
must not turn one note into a hundred rows to review.

The division of labour is deliberate:

- **The model does language.** Which of the user's activities is meant, what the thing is called,
  which steps were listed, and where one entry ends and the next begins. It is handed the current
  date, the current time and up to 80 activity titles, and asked for a plain local date
  (`YYYY-MM-DD`) and clock time (`HH:mm`) per entry.
- **The app does arithmetic.** Timezone, day boundary and instant construction never reach the
  prompt. Date maths is what a language model is worst at and what the app already knows how to do.

Rules applied to the reply, none of which trust it:

- **Activity names match exactly**, ignoring case and surrounding space, and nothing looser. A
  substring match would attach "run" to "Run errands", and an occurrence pointed at the wrong
  activity corrupts that activity's whole history - its cadence, its habitual start time, every
  suggestion drawn from it. No match opens the draft as a new event instead. The prompt carries the
  burden: it tells the model to copy a listed title character for character.
- **Event-kind activities are not offered.** Their activity row backs one occurrence and is not a
  reusable thing to log again.
- **A note with no day floats.** Guessing today is a confident wrong answer, and "sometime" is a
  real answer in this app.
- **A day named with no clock time is filled in from the activity's own hours.** "work tomorrow"
  becomes 09:30-17:00 because that is what Work has been, using the same habitual start time and
  median duration the recommendation engine places a suggestion at - so capture and suggestions can
  never disagree about the user's routine. Observed behaviour outranks the model's `allDay` flag,
  which is one line of text against months of evidence. Falls back to date-only when there is no
  habit to read: no match, no completions, or too few to clear the engine's support and share
  thresholds. Activities that genuinely are all-day need no special case - all-day completions are
  excluded from start-time clustering, so they have no habitual hour to find.
- **An entry with no title of its own takes the name of the activity it matched**, and only falls
  back to the note text when it matched nothing. With several entries the note describes all of
  them, so it is a poor title for any one.
- Nonsense dates, out-of-range durations and over-long titles are dropped rather than rejected: a
  draft missing a field is still worth reviewing.
- **A reply with no entries at all is `Unavailable`**, not an empty answer: there is nothing to show
  and nothing to correct, so it is reported the way any other unusable reply is.

An activity that appears in several entries has its history read once, so a pasted week of the same
shift costs one lookup, not one per day.

### Accepting drafts

Each draft is a row in the capture dialog, ticked by default, with the count and an "untick anything
you do not want" line above when there is more than one. **Add** creates the ticked ones in order and
closes the dialog. The editor is still one click away per row, for the drafts that need a correction
first - it is there for the exceptions, not as a tollgate every draft has to pass.

A row that has been created is marked **Added** and cannot be ticked again, including when a run
fails half way: what got through is real, so the retry only covers what is left. Drafted subtasks are
created in a second pass after the occurrence exists, since neither create endpoint takes them.

**The call's cost is shown, not logged**: wall clock, model-load time, and tokens in and out, along
the bottom edge of the dialog, with the raw reply one click away. Local inference is slow enough that
hiding the number would read as a hang, and these are the figures that decide where else an assistant
feature can live - but they are diagnostics, so they sit beside the buttons rather than between the
drafts and the decision about them. They belong to the call, not to any one draft: one call, one
cost, however many entries came out of it.

---

## API surface

All routes require a bearer token except `/api/auth/*` and `/api/health`. Endpoints are thin: parse →
service → `Result` → problem details, with Validation→400, NotFound→404, Conflict→409,
Unauthorized→401, Forbidden→403, Unavailable→503.

| Route | Methods |
|---|---|
| `/api/health` | `GET` |
| `/api/auth/register`, `/login`, `/refresh`, `/logout` | `POST` |
| `/api/auth/me` | `GET` |
| `/api/activities` | `GET` (`goalId`), `POST` |
| `/api/activities/{id}` | `GET`, `PUT`, `DELETE` |
| `/api/activities/{id}/recommendations` | `PATCH` (mute toggle only) |
| `/api/activities/{id}/subtasks[/{subtaskId}]` | `POST`, `PUT`, `DELETE` |
| `/api/occurrences` | `GET` (`status`, `startFrom`, `endBefore`, `floating`, `goalId`, `activityId`), `POST` |
| `/api/occurrences/{id}` | `GET`, `PUT`, `DELETE` |
| `/api/occurrences/{id}/status` | `POST` |
| `/api/occurrences/{id}/subtasks[/{subtaskId}[/toggle]]` | `POST`, `PUT`, `DELETE` |
| `/api/occurrences/event`, `/api/occurrences/{id}/event` | `POST`, `PUT` |
| `/api/goals` | `GET` (`status`), `POST` |
| `/api/goals/{id}` | `GET`, `PUT`, `DELETE` |
| `/api/goals/{id}/status` | `POST` |
| `/api/goals/{goalId}/checkpoints[/{id}[/status]]` | `GET`, `POST`, `PUT`, `DELETE` |
| `/api/categories[/{id}]` | `GET`, `POST`, `PUT`, `DELETE` |
| `/api/activity-types[/{id}]` | `GET`, `POST`, `PUT`, `DELETE` |
| `/api/states[/{id}]` | `GET`, `POST`, `PUT`, `DELETE` |
| `/api/states/snapshot` | `GET` (`at`, defaults to now) |
| `/api/states/{stateId}/values[/{id}]` | `POST`, `PUT`, `DELETE` |
| `/api/recommendations` | `GET` (`date`, `chain`) |
| `/api/insights`, `/api/insights/empty-profile` | `GET` (`period`) |
| `/api/settings` | `GET`, `PUT` |
| `/api/llm/status`, `/api/llm/capture` | `GET`, `POST` |
| `/api/export` | `GET` |
