# Stryde — Product Spec

A brain space for goals, deadlines and motivation. Built around three primitives: **Goals**,
**Activities**, and **Occurrences**. Single user in practice; the schema, auth layer, and every query
are scoped by `UserId`.

This document describes what the app does today. Visual rules live in `design.md`; code navigation
and conventions live in `CLAUDE.md`.

## What Stryde is not

Stryde does not ask you to log your life. There is no suggestion engine, no scheduling model, and no
stat that divides by the length of a day - so **sleep, work and commuting do not belong in it** unless
you want them there for your own reasons. Nothing computes a wrong answer because they are missing.

This is a hard product boundary, and the test for any new feature is:

> Does this still produce a correct answer if the user logs only the things they care about?

A feature that needs a complete calendar to be right - free-slot placement, "unaccounted" time,
inferred availability, anything that reads meaning into an empty hour - fails that test and does not
belong here, however useful it looks. Everything that ships today passes it: totals sum what was
logged, cadence looks only at one activity's own completions, and checkpoint progress is entered by
hand.

The calendar is a **visualization and a fast way to add things**, not a planner and not a log.

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
- Registration captures the browser's timezone.

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
| Kind | `activity` or `event`. Internal, never shown. |
| Subtasks | Ordered checklist template, copied onto every new occurrence. |

Deleting an activity cascades to its occurrences. Deleting a goal or category set-nulls the link and
leaves the activity alive.

### Kinds: activity vs event

- **`activity`** — a reusable definition. It owns many occurrences and is what `/api/activities`
  lists and what the activity picker offers.
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

---

## Occurrences

| Field | Notes |
|---|---|
| Activity | Required. Which activity this is an instance of. |
| Title | Optional, overrides the activity title for this instance. Max 255. |
| Start datetime | Absent for floating; window start when `IsPlanned`. |
| End datetime | Window end when `IsPlanned`; deadline or span end otherwise. Must be after start. |
| Is all day | Marks a date-only occurrence. |
| Is planned | Marks a flexible/windowed occurrence (dashed on the calendar, never overdue). May be set on a floating occurrence. |
| Duration minutes | Effort estimate, valid on any occurrence type. On a planned occurrence with both window bounds it may not exceed the window length. |
| Status | `pending`, `done`, `skipped`. Marking done clears `IsPlanned`. |
| Subtasks | Per-occurrence checklist with `IsDone`, seeded from the activity's template. |

`effectiveTitle` on the DTO is `title ?? activity.title`. The DTO also carries the full activity
(with its category and goal), which is why occurrence lists are invalidated after an activity write. Legacy `windowStart`/`windowEnd`/`windowDurationMinutes` columns remain on the row
and are honoured by range filtering; nothing in the UI writes them.

### Scheduling states

**Scheduled** — a start datetime and `IsPlanned = false`. Participates in overdue detection and is
drawn as a solid calendar block.

**Due pin** — a start with no end. A deadline rather than a commitment to a span: the grid draws it
30 minutes tall and pins it in the calendar's sticky Due row.

**Planned** — `IsPlanned = true`. `StartAt`/`EndAt` act as window bounds when both are present;
`EndAt` alone is a soft due date; `IsAllDay` marks a flexible all-day task. Drawn as a dashed,
diagonally striped block spanning the window, grouped under "Planned" in list views, and never
overdue - the flag says the time is flexible, not that a commitment is missing.

**Floating** — no start, no end, not all-day. This is the "keep it somewhere" state, and the reason
the app can hold an intention without turning it into an appointment. `IsPlanned` splits where it
surfaces: a planned floating occurrence is already committed to and only needs a time, an unplanned
one is not yet.

The calendar's FLOAT row shows both, planned first, and either can be dragged into the grid to give
it a time. The Daily Plan lists unplanned floating occurrences in its "Floating" group on every day,
since they have no day of their own. On the Categories page a planned floating occurrence groups
under "Planned" and an unplanned one under "Floating". Floating occurrences are never overdue. The
`floating=true` list filter also drops occurrences whose activity is on a benched goal.

**All-day planned** is the other holding state: a date with no time, for something that belongs to a
day without belonging to an hour of it.

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
correcting history in bulk after splitting one activity into several.

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

- **Focus** — what you are actually working on. Shown at the top of the Daily Plan.
- **Active** — live, but not the current focus.
- **Bench** — deprioritised. Its activities are hidden from the calendar's float row.
- **Closed** — archived. Shown dimmed in a Closed section.

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

---

## Views

| Route | Purpose |
|---|---|
| `/plan` | Daily Plan: one day's agenda. Index route. |
| `/calendar` | Day / 3-day / week grid. Visualization, and the fastest way to add something. |
| `/categories` | Occurrence lists per category, plus "Active" and "No category". |
| `/goals`, `/goals/:id` | Goal list with progress, and per-goal detail with notes and checkpoints. |
| `/activities`, `/activities/:id` | Activity list and detail (subtasks, occurrence history). |
| `/insights` | Totals over what was logged. |
| `/settings` | Preferences, data export, sign out. |

`/inbox` redirects to `/categories`. `/activities`'s static segment outranks `/activities/:id`.

Navigation: a 240px desktop sidebar (Daily Plan, Calendar, Goals, Activities, Insights, then the
category list with inline add/edit/delete, and Settings pinned at the bottom); on mobile a 5-slot
bottom bar (Plan, Categories, Calendar, Goals) plus a "More" sheet holding Activities, Insights, and
Settings. Nav items are not `end`-matched, so drilling into a goal or activity keeps the parent item
lit.

### Daily Plan

One day, read as a list. There is no score for the day: no completion ring and no done/left counts,
because those rate how much of a day was executed, which is the planner reading this app is not for.

- **Focus goals** — one chip per focus goal at the top of the page: title, last-session recency, and
  either its milestone percentage or its ongoing occurrence bar. Goals lead the day, not metrics.
- **Overdue** — on today's view only, every overdue occurrence regardless of the day it was
  scheduled for, with its date, above the agenda and not in it. One button moves the whole set to
  tomorrow, preserving each clock time.
- **Timeline agenda** — the day's timed occurrences as a spine with a time gutter, split by a live
  **now** marker into past and upcoming, with relative labels ("now", "in 40m") on today. Rows carry
  a one-tap done checkbox, a skip action, and an action menu.
- **Planned** and **Floating** sections below the agenda.
- Day navigation (prev / next / today / date picker) using the same boundary semantics as the
  calendar.

### Calendar

Day, 3-day, and week views (choice persisted), with prev/next, jump-to-today, and a date picker.

The calendar is a **picture of what you have decided**, not a plan the app made and not a record it
expects you to complete. Empty grid means nothing in particular.

- Scheduled occurrences as solid blocks, planned ones dashed and striped. They are packed in one
  pass, so an overlap renders side by side; every block in a cluster of transitively-overlapping
  spans shares one width.
- A sticky header with an **all-day row** and a **FLOAT row**; occurrences can be dragged between
  those rows, from a row into the grid (which gives them a time), and between day columns.
- **Clicking (or tapping) empty grid creates** a 30-minute occurrence at that quarter hour, pre-filled
  in the create modal. Dragging still sets an exact span, and a long press does it on touch - but the
  cheapest gesture now does the most common thing, which is the calendar's whole job here.
- Drag-to-move and resize on existing blocks, snapping to 15 minutes. Clicking a block opens the
  occurrence detail modal. A dragged block is held inside its day **by its end, not by the pointer**:
  it stops when its bottom edge reaches midnight, however deep into the block it was grabbed. So an
  occurrence cannot be dragged across midnight - the model and the grid both still handle ones that
  do, they are just made in the edit modal.
- A sticky **Due** row keeps due pins and overdue items visible while scrolling.
- Adjustable slot height (zoom controls and pinch, persisted).
- **Compact mode** (toolbar toggle, persisted) elides each day's empty stretches into labelled bands
  a few pixels tall, leaving the day's actual content at the same scale it always had. A stretch is
  collapsed when it is at least 45 minutes long *and* would have been at least half again the band's
  own height, so the threshold tracks the zoom and a band never costs more grid than it saves.
  Occupied ranges keep a quarter hour of breathing room either side and snap out to the quarter hour.
  In a multi-day view **every column collapses its own emptiness**, so hours do not line up across
  columns - two days with nothing in common have nothing to align on, and a shared scale could only
  collapse what every visible day agreed was empty. The current time always stays visible.
- **Any drag restores the full 0-24 grid** for the length of the gesture, so moving, resizing,
  creating and dropping in from the header rows all address real times. The grid re-collapses on
  release. Whatever was under the pointer holds its position across both switches, and across zoom.
- On touch only a **deliberate tap** counts: short, still, on a grid that is not moving and was not
  gliding when the finger landed. A scrolling finger looks like a tap at several points - stopping
  momentum, resting before a flick - and none of those may create anything.

### Categories

Three kinds of view over the same occurrence list: **Active** (`?all=true`, every pending occurrence
across all categories), **No category** (the default: occurrences whose activity has no category),
and one per category (`?category={id}`). Rows group into Overdue → Today → Planned → Upcoming →
Floating → Completed/Skipped, with overdue winning over the day grouping.

### Activities

One flat list: title search and a grouping toggle over **Goal / Category / None** (persisted in
`localStorage`). Sections collapse and carry counts; rows sort by title within a section.

Each row leads with a tile in its **category's colour and icon** - the same colour that draws its
occurrences everywhere else - then title and a meta line dropping whatever the section header already
says, then an action menu (history, edit, delete). **Multi-select mode** turns the tiles into
checkboxes and the row actions into a bottom bar: assign, delete, with per-section select-all. Bulk
assign sets goal and category across the selection, each field defaulting to "keep current"; it fans
out over the single-item PUT, resending unchanged fields.

**Activity history** opens read-only from a row's action menu: last done, cadence, usual time, usual
length, an eight-week grid of one cell per day laid out as a calendar, and the ten most recent
occurrences. Every figure is derived in the client from that activity's own occurrences, so it stays
correct however little else is logged.

---

## Insights

Read-only totals over **done occurrences**, computed server-side (`GET /api/insights?period=N`, 7 or
30 days, the page defaults to 7) in the user's day context. Occurrences with no `StartAt` are
excluded - they have no day to count on.

| Stat | Rule |
|---|---|
| Time by activity | Per activity over the window: summed minutes and count, from occurrences with both timestamps and positive elapsed time. Sorted by time. Bars in the activity's category colour. |
| Time by category | Same set grouped by the activity's category; uncategorized completions form a "No category" bucket. |

Both are sums over what the user chose to log. **There is deliberately no stat whose denominator is
the length of a day** - no unaccounted time, no gap analysis, no "usually free" profile. Those all
answer "what is missing from the calendar", which is only a meaningful question if the calendar is
supposed to be complete, and here it is not. Today counts like any other day, since nothing is
averaged over days.

---

## Settings

| Setting | Notes |
|---|---|
| Timezone | Captured from the browser on registration; editable here. |
| Day start | The time the day rolls over. |
| Max focus goals | Hard limit on simultaneous Focus goals, 1-20. |
| Theme | Light / dark / system. Client-side preference in `localStorage`, defaults to system. |
| Server URL | Native shells only: where the app points its API calls. |
| Export data | Downloads `stryde-export-<date>.json`. |
| Account | Username and sign out. |

Settings holds preferences only.

**Data export** (`GET /api/export`) is a single JSON document: user, settings, categories, goals with
checkpoints, activities with subtasks, and flat occurrences (effective title, no nested activity). Good enough to hand to a person or an LLM for analysis; not a
backup format, since there is no import path and the shape may change freely.

---

## API surface

All routes require a bearer token except `/api/auth/*` and `/api/health`. Endpoints are thin: parse →
service → `Result` → problem details, with Validation→400, NotFound→404, Conflict→409,
Unauthorized→401, Forbidden→403.

| Route | Methods |
|---|---|
| `/api/health` | `GET` |
| `/api/auth/register`, `/login`, `/refresh`, `/logout` | `POST` |
| `/api/auth/me` | `GET` |
| `/api/activities` | `GET` (`goalId`), `POST` |
| `/api/activities/{id}` | `GET`, `PUT`, `DELETE` |
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
| `/api/insights`, `/api/insights/empty-profile` | `GET` (`period`) |
| `/api/settings` | `GET`, `PUT` |
| `/api/export` | `GET` |
