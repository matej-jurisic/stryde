# Stryde — Implementation Plan

10 phases, each producing working, committed software. Phases build on the previous — no phase leaves the app in a broken state.

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

## Phase 8 — Recommendation Engine

**Goal:** The app surfaces what to work on next, ranked by the rules in the spec.

**Backend**
- `GET /api/recommendations?date=YYYY-MM-DD` endpoint
- Implements the 7-tier ranking from the spec:
  1. Events due today, not yet scheduled
  2. Overdue events
  3. Events linked to Focus goals with lagging actual progress
  4. Events linked to Active goals with lagging actual progress
  5. Floating events linked to Focus goals
  6. Floating events linked to Active goals
  7. Floating events linked to Bench goals
- Within tiers: sort by due date ascending, then duration ascending

**Frontend**
- Recommendation strip displayed in the Calendar day view
- Each recommendation shows title, linked goals, and a one-click schedule action
- Strip is collapsible

**Done when:** The recommendation strip is visible on the day view and updates correctly as events are completed or scheduled.

---

## Phase 9 — Repeat Rules

**Goal:** Events can repeat. The engine generates next instances correctly and handles deletion gracefully.

**Supported patterns:** daily, weekly on specific days, every N days/weeks/months, monthly on a date.

**Backend**
- Repeat rule stored as structured JSON (pattern type + config)
- On event complete: next instance generated with same rule, linked to same goals
- On event skip: same as complete, current marked skipped
- On event reschedule: datetimes updated, rule unchanged
- On event delete: request body specifies `scope` — `this` (current instance only) or `future` (current + all future)

**Frontend**
- Repeat rule picker in the event creation/edit modal
- On delete of a repeating event: prompt the user — "Delete this event only" or "Delete this and all future repeats"

**Done when:** A repeating event cycles correctly through completions, skips, and reschedules. Deletion prompt works for both scopes.

---

## Phase 10 — Settings, Progress Insights & Polish

**Goal:** The app is complete, coherent, and usable on both mobile and desktop.

**Settings page**
- Timezone (auto-detected on first open, user-editable)
- Day boundary time
- Max Focus goals

**Goal progress insights**
- Actual progress: each completed linked event contributes a fixed increment (Open Decision #1 resolved to fixed increment for v1)
- Insight displayed on goal detail: believed vs actual, simple diff, count of linked events completed this week

**Polish**
- Mobile layout pass — all views usable on small screens
- Loading states for all async operations
- Error states and toast notifications for failures
- Form validation error messages consistent across all modals
- Empty states for all list views
- Page titles and basic navigation structure finalized

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
| 1 | Event → goal progress attribution | Phase 10 (fixed increment for v1) |
| 2 | Recommendation rule tie-breaking within tiers | Phase 8 |
| 3 | Time ribbon layout details | Phase 7 |
| 4 | Goal list ordering | Phase 5 |
