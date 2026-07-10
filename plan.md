# Stryde — Implementation Plan

Phased build, each phase producing working, committed software. Phases build on the previous — no phase leaves the app in a broken state.

---

## Phase 1 — Project Setup ✅

**Goal:** Both projects running locally, talking to each other, with a working dev loop.

- ASP.NET Core Web API project (`src/Stryde.Api`)
- React + Vite + TypeScript project (`client/`)
- SQLite database wired up via EF Core
- EF Core migrations (`InitialCreate`, `CoreDataModel`)
- CORS configured for local dev (`Cors:Origins`)
- `appsettings.json` for config; JWT secret via env var (`Jwt:Secret`)
- Proxy configured in Vite so `/api` calls hit the backend during dev
- `docker-compose.yml` + `Dockerfile` — 3-stage build (node → dotnet → aspnet runtime)
- Health check endpoint (`GET /api/health`) returning 200

**Done when:** `npm run dev` and `dotnet run` both start cleanly for local development, and `docker compose up` brings up the full stack with the React app reachable in the browser.

---

## Phase 2 — Auth ✅

**Goal:** Users can register and log in. All subsequent API calls are authenticated.

**Backend**
- `User` + `RefreshToken` entities; BCrypt password hashing
- JWT access token (~15 min) in response body; 6-month refresh token in httpOnly cookie (`/api/auth`)
- Refresh token rotation — only SHA-256 hex hash stored
- `POST /api/auth/register`, `/login`, `/refresh`, `/logout`, `GET /api/auth/me`
- All non-auth endpoints require authorization

**Frontend**
- Login and register pages (timezone auto-detected on register)
- Zustand auth store — access token in memory only
- `lib/api.ts` with one-shot 401 refresh retry (de-duplicated)
- Bootstrap `useEffect` on mount calls `/refresh` to restore session from cookie

**Done when:** A user can register, log in, reach `/plan`, and have session restored on reload.

---

## Phase 3 — Core Data Model ✅

**Goal:** All entities exist in the database with correct relationships and a full CRUD API for each.

**Entities added:** `Event`, `Goal`, `Checkpoint`, `RepeatRule`, `UserSettings`
- `Event ↔ Goal` many-to-many via skip navigation (join table `EventGoals`)
- `UserSettings` one-to-one with `User` (UserId as PK)
- All enums stored as strings via `HasConversion<string>()`

**API**
- Full CRUD for events, goals, checkpoints; `GET/PUT /api/settings`
- `POST /api/events/{id}/status`, `POST /api/goals/{id}/status`, `POST /api/goals/{goalId}/checkpoints/{id}/status`
- Event filters: status, startFrom, endBefore, floatingOnly
- Goal filters: status
- Focus limit enforced in `GoalService.SetStatusAsync` via `UserSettings.MaxFocusGoals`

**Tests**
- xUnit integration tests via `WebApplicationFactory` with in-memory SQLite
- Factory uses `builder.UseSetting("Jwt:Secret", ...)` so the eager config read in Program.cs sees the test secret
- `HttpHelpers`: `SetupUserAsync`, `UseBearer`, `ReadAsync<T>`

**Done when:** `dotnet test` passes (11 tests green).

---

## Phase 4 — Events UI ✅

**Goal:** Users can manage their events from the frontend.

- Event creation modal (title, optional start/end datetime, optional goal links)
- Event edit modal (same fields)
- Event list page (temporary — replaced by Inbox and Calendar in later phases)
- Mark event done / skipped
- Delete event
- Goal multi-select in the event modal (loads existing goals)
- Client-side form validation matching server validation

**Done when:** A user can create, edit, complete, skip, and delete events entirely from the UI.

---

## Phase 5 — Goals UI ✅

**Goal:** Users can manage goals and checkpoints, with the Focus limit enforced.

- Goals list page with status grouping (Focus → Active → Bench → Closed)
- Goal creation and edit modal
- Status transitions (promote to Focus, move to Bench, close)
- Focus limit enforced: moving a goal to Focus is blocked at the hard limit with a clear message
- `max_focus_goals` setting wired to the user settings table
- Checkpoint list within a goal detail view
- Checkpoint creation, edit, mark reached, delete
- Believed progress displayed per goal (sum of reached checkpoint planned progress values)

**Done when:** A user can manage their full goal and checkpoint hierarchy. The Focus limit blocks correctly.

---

## Phase 6 — Inbox View ✅

**Goal:** Floating events have a dedicated home and can be acted on from there.

- Inbox view listing all floating events (no start datetime), sorted by creation date
- Quick actions per event: edit, complete, skip, delete, schedule (opens edit modal pre-focused on datetime)
- Empty state
- Event count in nav

**Done when:** The Inbox is the authoritative view for all unscheduled work.

---

## Phase 7 — Calendar View ✅

**Goal:** Users can see their scheduled events on a calendar and place events in time.

- Day view and week view toggle
- Day navigation (previous / next, jump to today, date picker)
- Scheduled events rendered as blocks in their time slots
- Clicking an event opens the edit modal
- Creating an event from a time slot pre-fills start datetime
- Overdue events visually distinguished
- Day boundary respected (configurable roll-over time from settings)

**Done when:** A user can see, navigate, create, and edit scheduled events from the calendar.

---

## Phase 8 — Recommendation Engine ✅

**Goal:** The app surfaces what to work on next, ranked by the rules in the spec.

**Backend**
- `GET /api/recommendations?date=YYYY-MM-DD` endpoint (date optional; defaults to the user's current day)
- Implements the 7-tier ranking from the spec:
  1. Events due today, not yet done
  2. Overdue events
  3. Events linked to Focus goals with lagging actual progress
  4. Events linked to Active goals with lagging actual progress
  5. Floating events linked to Focus goals
  6. Floating events linked to Active goals
  7. Floating events linked to Bench goals
- Within tiers: sort by due date ascending, then duration ascending; dedupe into the highest qualifying tier

**Frontend**
- Recommendation panel (persistent 320px column, not a collapsible strip) in the Calendar day view
- Each recommendation shows title, primary linked goal, duration, and a one-click schedule action

**Deferred to Phase 10:** the "lagging actual progress" filter for tiers 3/4 (needs the fixed progress increment); until then all pending scheduled events linked to focus/active goals qualify.

**Done when:** The recommendation panel is visible on the day view and updates correctly as events are completed or scheduled. ✔

---

## Hardening pass (July 2026) ✅

Unplanned correctness and polish work done after Phase 8:

- **Timezone-aware day logic, server-side.** All day-bucketing (due today, overdue, "today") now runs in the user's IANA timezone offset by `DayBoundaryTime`, via `Common/DayMath.cs`. Previously everything was UTC.
- **`isOverdue` on the event DTO.** Computed once server-side; the three divergent client-side overdue implementations were removed.
- **Settings page** (`/settings`): timezone, day boundary, max Focus goals, light/dark/system theme toggle (localStorage), sign out. The settings PUT now also updates `User.Timezone`.
- **Checkpoint cap:** a goal's checkpoints may not plan more than 100% total progress.
- **Query key unification:** all event lists live under the `['events', ...]` prefix; event writes invalidate `['events']` + `['recommendations']`; goal writes additionally invalidate `['events']`. Fixed a cache collision where the sidebar badge and the Inbox page shared a key with different fetches.
- **Removed** the temporary Events page (Inbox + Calendar cover it) and a leftover diagnostic test.
- **Unit tests** for the recommendation tiers, timezone bucketing, day-boundary overdue, and the checkpoint cap (20 tests total).

---

## Phase 9 — Base Events & Recommendation Rework ✅

**Goal:** Introduce Base Events as event templates and rework the recommendation engine to answer "what should I add to today's schedule?" rather than echoing what is already there.

**Backend**
- `BaseEvent` entity: `Id, UserId, Title, CategoryId?, CreatedAt`; many-to-many `BaseEvent ↔ Goal`
- `Event.BaseEventId?` FK added via migration; null for existing events
- `EventService.CreateAsync` auto-creates a `BaseEvent` (mirroring title, category, goals) when none is provided; sets `BaseEventId` on the new event
- `GET /api/base-events/search?q=` — searches user's base events by title for the link UI
- `RecommendationService` rework:
  - Remove tiers 1 (due today) and 2 (overdue) — those belong in the inbox and daily plan
  - Tier 1: floating events linked to Focus goals
  - Tier 2: floating events linked to Active goals
  - Tier 3: BaseEvents with ≥2 completions on today's weekday in the past 6 weeks, no instance on today's schedule — frequency desc within tier
  - Tier 4: floating events linked to Bench goals (only when tiers 1-3 are empty)

**Frontend**
- Event creation/edit modal: "Link to existing" search field; on select, pre-fills title, category, goals from the chosen Base Event
- Update recommendation panel tier labels and groups to match new tiers
- Tier 3 recommendation items show the Base Event title with a "create from this" action (creates a new floating or scheduled event pre-filled from the Base Event)

**Done when:** Every new event has a BaseEventId. Recommendations surface what to add to the schedule, not what's already on it. Pattern suggestions (tier 3) appear once ≥2 completions on a weekday exist. ✔

---

## Base Event Redesign (July 2026) — unplanned

**Problem:** Auto-creation on every event produce silent "ghost" base events the user never intended as templates. The recommendation tier-3 pattern detector fires on this noise, yielding spurious suggestions. The user has no way to see or curate base events, so the list grows unchecked.

**Decision:** Base events become explicit, goal-scoped templates that the user creates intentionally.

**Data model change**
- `BaseEvent.GoalId` (required FK) replaces the many-to-many `BaseEvent ↔ Goal` join table — a base event belongs to exactly one goal.
- `Event.BaseEventId?` stays optional; events without a base event link are valid.
- Auto-creation in `EventService.CreateAsync` is removed.

**API**
- `POST /api/goals/{goalId}/base-events` — create a template under a goal
- `GET /api/goals/{goalId}/base-events` — list a goal's templates
- `PUT /api/base-events/{id}`, `DELETE /api/base-events/{id}` — edit/delete
- `GET /api/base-events/search?q=` kept (or made goal-scoped) for event modal lookup

**Frontend**
- Goals detail view: template list per goal; add/edit/delete base events inline
- Event modal: once a goal is selected, show that goal's base events as template options; selecting one pre-fills title and category
- Remove the cross-goal free-text base event search from the event modal

**Migration notes:** existing auto-created base events with no goal links are deleted; those with one or more links have `GoalId` set to their first linked goal, join table dropped.

---

## Goal-less Base Events (July 2026) ✅

**Problem:** `BaseEvent.GoalId` was required, so recurring activities with no goal (e.g. "Work", "Exercise") could not be given a template and were invisible to the tier-3 habit-detection system.

**Change:** `BaseEvent.GoalId` is now nullable (`Guid?`). Base events without a goal are first-class templates.

**Backend**
- `BaseEvent.GoalId` → `Guid?`, navigation property `Goal?`; migration `BaseEventGoalOptional`
- `BaseEventService.CreateAsync` accepts `Guid? goalId`; validates goal only when provided
- `BaseEventService.ListGoallessAsync` — returns all user templates with no goal
- `GET /api/base-events/goalless` — list goal-less templates
- `POST /api/base-events/` — create a goal-less template
- `BaseEventSummaryDto`: `GoalId?`, `Goal?`; `FromEntity` null-safe

**Frontend**
- `BaseEventSummary` type: `goalId: string | null`, `goal: GoalSummary | null`
- `GoalsPage`: new `GoallessTemplatesSection` at the bottom of the page (visible even with no goals); uses query key `['base-events', null]`
- `RecommendationStrip`: `BaseEventRecItem` shows goal badge only when `goal` is non-null
- `EventModal`: `goalIds` pre-fill skips null `goalId` when opening a goal-less template

---

## Windowed Events (July 2026) ✅

Unplanned addition after Phase 9. Adds a third event scheduling state between floating and fully scheduled.

**Problem:** Users often know an event will take a specific amount of time but haven't decided exactly when it will occur within a window (e.g., "this 2-hour workout will happen somewhere on Sunday" or "anytime between Friday 15:00 and Saturday 22:00"). The existing model forced a choice between no time at all (floating, inbox only) or a pinned start time.

**Backend**
- `Event` entity: `WindowStart DateTimeOffset?`, `WindowEnd DateTimeOffset?`, `WindowDurationMinutes int?`
- Migration: `AddWindowedEventFields`
- `EventService.ValidateWindow`: all three fields must be provided together, cannot combine with `StartAt`, end > start, duration > 0, duration ≤ window length
- `EventService.ListAsync`: `floatingOnly` now excludes windowed events; calendar range queries include windowed events whose window overlaps the requested range

**Frontend**
- `Event` type extended with `windowStart`, `windowEnd`, `windowDurationMinutes`
- `EventModal`: third scheduling mode "Flexible window" — window start/end pickers plus h/min duration inputs; reachable via "+ Set flexible window" from due-date or start/end modes
- `CalendarPage`: `WindowedEventBlock` renders windowed events as dashed, diagonally striped blocks spanning their window within each day column; multi-day windows clip correctly per column; colored by first linked goal status or category

**Done when:** A windowed event appears on the calendar spanning its window as a dashed block, is excluded from the Inbox, and can be created/edited via the flexible window mode in the event modal.

---

## Phase 10 — Daily Plan Page ✅

**Goal:** `/plan` becomes a real execution view instead of a placeholder. See spec.md (Daily Plan) for the full definition.

- Today's agenda: the day's scheduled events as an ordered list with one-click done/skip (checkbox = done; hover skip button = skipped; clicking title opens EventDetailModal for edit/delete)
- Recommendations in the middle column (`RecommendationPanel` reused; clicking a floating event rec opens EventDetailModal, base event rec opens EventModal pre-filled)
- Goal health strip: Focus goals with believed progress bar and percentage (actual progress deferred to Phase 12)
- Day navigation (prev/next/today + date picker), same day-boundary semantics as the calendar
- Mobile: single column, agenda first; recommendations behind drawer toggle

**Done when:** Logging in lands on a Daily Plan that answers "what should I do right now" without opening the calendar. ✔

---

## Android APK (July 2026) ✅

**Goal:** Ship Stryde as a signed Android APK using Capacitor, distributable via Obtainium or sideload.

- Capacitor wraps the Vite/React SPA in a native Android WebView (`appId: dev.stryde.app`)
- `@capacitor/core` + `@capacitor/android` added to `client/package.json`; `androidScheme: https` so the WebView origin is `https://localhost`
- `client/capacitor.config.ts` — Capacitor config; `webDir: dist`
- Android project generated at `client/android/` via `npx cap add android`
- `client/android/app/build.gradle` patched with release signing via env vars (`STRYDE_KEYSTORE`, `STRYDE_KEYSTORE_PASSWORD`, `STRYDE_KEY_ALIAS`, `STRYDE_KEY_PASSWORD`)
- `client/android/.gitignore` excludes auto-generated assets, cordova plugins, `local.properties`, build output
- **Server URL config** (`client/src/lib/server-config.ts`): since the APK can't use relative `/api` paths, a server URL is stored in `localStorage` and prepended to every `fetch` in `api.ts`. When `getServerUrl()` returns `''` (web mode), all URLs stay relative and the existing Vite proxy + Docker serving work unchanged
- Login and register pages show a "Server URL" field when `isNative()` (Capacitor-detected); Settings page adds a "Connection" section for the same
- Backend `Cors:Origins` gains `https://localhost` (Capacitor WebView origin)
- `stryde-build.ps1` — local one-command release script (gitignored): bumps `versionCode`/`versionName`, builds SPA, `cap sync android`, signs with keystore via env vars, stages APK to `release/`
- npm scripts added: `android:sync`, `android:open`, `android:apk`

**Build flow:** `.\stryde-build.ps1` from repo root. First run creates the keystore at `D:\Projects\stryde-release.jks`. Set `$remoteHost` in the script to SCP the APK to a homelab server for Obtainium distribution.

---

## Activity / Occurrence Remodel (July 2026) ✅

**Problem:** The `BaseEvent`/`Event` naming was confusing ("base event" is not a natural term), and the model mixed the definition of an activity with its scheduled instance. The GoalsPage hosted base-event management inline, making it cluttered and limiting (activities without goals had no clean home).

**Change:** Replace `BaseEvent` + `Event` with `Activity` + `Occurrence`.

- `Activity` — the definition layer (title, single optional goal, optional category). Managed on the new `/activities` page.
- `Occurrence` — the scheduling layer (required `ActivityId` FK, optional title override, all scheduling fields). Exposed via `/api/occurrences`.

**Data model**
- Dropped: `BaseEvents`, `Events`, `EventGoals` tables.
- Added: `Activities` (Id, UserId, Title, CategoryId?, GoalId?, CreatedAt) and `Occurrences` (Id, UserId, ActivityId, Title?, StartAt?, EndAt?, Status, IsAllDay, WindowStart?, WindowEnd?, WindowDurationMinutes?, RepeatRuleId?, CreatedAt).
- Migration: `ActivityOccurrenceModel`.
- `OccurrenceDto.EffectiveTitle` = `occurrence.Title ?? occurrence.Activity.Title`.
- Recommendations now return a discriminated union: `type: 'occurrence' | 'activity'`.

**Backend**
- New: `Activity.cs`, `Occurrence.cs`, `ActivityService.cs`, `OccurrenceService.cs`, `ActivityEndpoints.cs`, `OccurrenceEndpoints.cs`.
- Deleted: `Event.cs`, `BaseEvent.cs`, `EventService.cs`, `BaseEventService.cs`, `EventEndpoints.cs`, `BaseEventEndpoints.cs`.
- `RecommendationService` rewritten: tier-3 returns Activity items, not BaseEvent items.
- `DayMath` updated: `OccurrenceDay(Occurrence, DayContext)`, `IsOverdue(Occurrence, ...)`.
- All unit and integration tests updated and passing.

**Frontend**
- New: `ActivitiesPage.tsx` — CRUD for activities, grouped by goal, with inline modal.
- Removed: all `BaseEventSummary`, `Event`, `baseEventsApi`, `eventsApi` references.
- Updated: `types.ts`, `api.ts`, `InboxPage`, `CalendarPage`, `PlanPage`, `GoalsPage`, `EventModal`, `EventDetailModal`, `RecommendationStrip`, `Sidebar`, `BottomNav`, `useInboxCount`.
- GoalsPage no longer hosts template management (that moved to ActivitiesPage).
- Route `/activities` added; Sidebar and BottomNav updated with Activities link.

---

## Phase 11 — Repeat Rules

**Goal:** Events can repeat. The calendar renders all future occurrences virtually; lists show only the next upcoming instance.

**Supported patterns:** daily, weekly on specific days, every N days/weeks/months, monthly on a date.

**Backend**
- Repeat rule stored as structured JSON (pattern type + config — schema is specced in spec.md, Repeats)
- `Recurrence/RecurrenceCalculator.cs` — enumerates occurrences for a date range from a `RepeatRule` via `DayMath`; virtual (no DB writes for future instances)
- Calendar endpoint expands repeat rules across the requested date range and merges with real events
- Inbox and recommendations show only the next upcoming instance of a repeating event
- On event complete/skip: current instance is marked; no new record created — future occurrences continue to be derived from the rule
- Idempotent: re-marking an already done/skipped instance must not produce another
- On event reschedule: datetimes of current instance updated, rule unchanged
- On event delete: scope `this` (current instance only) or `future` (deletes the rule, stopping all future occurrences)

**Frontend**
- Repeat rule picker in the event creation/edit modal
- Calendar renders virtual occurrences alongside real events
- On delete of a repeating event: prompt — "Delete this event only" or "Delete this and all future repeats"

**Done when:** A repeating daily event at 05:00-07:00 appears on every future day in the calendar. Only the next pending instance shows in lists. Completion, skip, reschedule, and both delete scopes work correctly.

---

## Phase 12 — Progress Insights & Polish

**Goal:** The app is complete, coherent, and usable on both mobile and desktop.

**Settings page** — ✅ done early in the hardening pass (timezone, day boundary, max Focus goals, theme, sign out)

**Goal progress insights**
- Actual progress: each completed linked event contributes a fixed increment (Open Decision #1 resolved to fixed increment for v1)
- Insight displayed on goal detail: believed vs actual, simple diff, count of linked events completed this week

**Polish**
- Mobile layout pass — all views usable on small screens
- Loading states for all async operations
- Error states and toast notifications for failures (design the toast pattern in design.md first)
- Form validation error messages consistent across all modals
- Empty states for all list views
- Page titles and basic navigation structure finalized
- Drag-and-drop: drag a recommendation onto the calendar grid to schedule it; drag/resize existing calendar blocks to reschedule
- Delete confirmations for events and goals (repeat-scope prompt ships with Phase 11)

**Docker Compose production hardening**
- `docker-compose.prod.yml` override (or env-based config) with production-appropriate settings
- API container: `ASPNETCORE_ENVIRONMENT=Production`, secrets via env vars, no dev certificates
- Frontend container: nginx serving the Vite build output, reverse-proxying `/api` to the API container
- SQLite data volume with a clear mount path for backups
- Restart policies on all services

**Done when:** All views work on mobile and desktop, settings persist correctly, progress insights are visible on goals, and `docker compose -f docker-compose.yml -f docker-compose.prod.yml up` runs a production-ready stack.

---

## Open Decisions to Resolve During Build

| # | Decision | Target Phase |
|---|---|---|
| 1 | Event → goal progress attribution | Phase 12 (fixed increment for v1) |
| 2 | ~~Recommendation rule tie-breaking within tiers~~ | Resolved in Phase 8: due date asc, duration asc, no-duration last, dedupe into highest tier |
| 3 | Time ribbon layout details | Resolved in Phase 7 (hour grid, drag-create, snap to 15 min) |
| 4 | Goal list ordering | Resolved in Phase 5: grouped Focus → Active → Bench → Closed, creation order within a group |
| 5 | Base Event mutation policy | When a user edits a Base Event directly (if ever exposed), do linked event instances update? Currently: no — instances are independent after creation. |
