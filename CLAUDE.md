# CLAUDE.md

Working guide for the Stryde repository.
- **`spec.md`** — product spec: what the app does, domain rules, data model fields.
- **`plan.md`** — build history and upcoming phases.
- **`design.md`** — visual/UX spec.

## Doc sync rule

**After every feature or meaningful change, update the docs before closing the task.**

- `CLAUDE.md` — update the file map or conventions if the codebase structure changed.
- `spec.md` — update if product behaviour, domain rules, or the data model changed.
- `plan.md` — add an entry (or update a phase) if a feature shipped or a decision was made.
- `design.md` — update if the UI or visual language changed.

Keep `CLAUDE.md` small: it is a navigation and convention guide, not a product spec. Domain rules belong in `spec.md`; visual rules belong in `design.md`; build history belongs in `plan.md`.

## What this is

Personal operations app built around three primitives: **Activities**, **Goals**, and the **Daily Plan**. Single-user initially; schema and auth are multi-user-ready from day one.

## Stack & layout

- **Backend:** ASP.NET Core (.NET 10) minimal APIs, EF Core, SQLite. Solution: `Stryde.slnx`.
- **Frontend:** React 19 + Vite + TypeScript, Tailwind CSS v4, TanStack Query, React Router.
- **Tests:** xUnit (unit + `WebApplicationFactory` integration).

```
src/Stryde.Core    Entities, EF DbContext, business services. No web dependencies.
src/Stryde.Api     ASP.NET Core host: endpoints, auth wiring, serves the SPA.
tests/Stryde.Tests Unit/ and Integration/ folders.
client/            React frontend (path alias `@` → `client/src`).
```

## Commands

```bash
dotnet build
dotnet test                                 # all tests (keep them green)
dotnet run --project src/Stryde.Api         # backend on :5200
cd client && npm install && npm run dev     # frontend on :5173, proxies /api → :5200
cd client && npm run build                  # tsc -b + production build

# EF migration:
dotnet ef migrations add <Name> --project src/Stryde.Core --startup-project src/Stryde.Api --output-dir Migrations

# Docker:
cp .env.example .env && docker compose up --build   # http://localhost:8080
```

## Architecture reference (file map)

**Backend (`Stryde.Core`)**
- `Entities/` — POCOs; `Guid Id = Guid.NewGuid()` + `DateTimeOffset CreatedAt`, no base class.
  Key entities: `User, Activity, Occurrence, Goal, Checkpoint, UserSettings, ActivityTypeSetting,
  State, StateValue, ActivityStateEffect, ActivityStateRequirement`
  (the last three are link/child rows keyed by their contents, not by a `Guid Id`: `StateValue` is a
  normal child of `State`, while `ActivityStateEffect` keys on `(ActivityId, StateId)` — one value per
  state, structurally — and `ActivityStateRequirement` on `(ActivityId, StateValueId)` — many per state,
  ORed within a state and ANDed across them.)
  (`ActivityTypeSetting` is the exception to the shape above: composite key `UserId, Type`, no `Id`,
  no `CreatedAt`, and sparse — a row exists only for a type the user edited, holding only the
  fields that differ from the default).
- `Enums/` — stored as strings (`HasConversion<string>`).
- `Data/StrydeDbContext.cs` — DbSets + `OnModelCreating`. `Occurrence → Activity` cascade delete; `Activity → Category/Goal` set-null.
- `Common/Result.cs` — `Result`/`Result<T>` + `Error(ErrorType, msg)`. **Expected failures = Results, not exceptions.**
- `Common/Validators.cs` — shared static validation rules.
- `Common/ActivityProfiles.cs` — the `ActivityType` **default** table (window, min block, cadence prior, max/day, cooldown).
  Add a type by adding a row; `ActivityType` is stored as a string, so a new value needs no migration
  (removing one does: see the two `*ActivityTypes` data migrations). The engine never reads it directly:
  it resolves per user through `ActivityProfileService.ResolveAsync`, which layers `ActivityTypeSetting`
  overrides on top. Window / min block / max/day are user-editable; cadence prior and cooldown are not.
  **Types hold scheduling numbers only** — no type refers to another type, and conditions belong to
  States. Don't reintroduce a type that names a real-life thing (`work`, `commute`) instead of a
  scheduling behaviour.
- `Common/StateTimeline.cs` — folds `StateSetter`s into a state's piecewise value over time, and
  answers `IntervalsWhere(allowedValueIds, from, to)`. Nothing about a state is persisted: the value at
  an instant is derived from the schedule, so moving an occurrence moves the state with it. A setter
  fires at its occurrence's **end** (`EndAt ?? StartAt`); a value's `DurationMinutes` decays it back to
  the state default; a later setter cancels a pending expiry. See `spec.md` → States.
- `Common/DayMath.cs` — all "which day / is this overdue?" logic goes through here, in the user's IANA
  timezone offset by `DayBoundaryTime`. Get a `DayContext` via `UserSettingsService.GetDayContextAsync`.
  Key methods: `OccurrenceDay(Occurrence, DayContext)`, `IsOverdue(Occurrence, DayContext, DateTimeOffset)`.
- `Dtos/Dtos.cs` — request/response records with `FromEntity` static factory. Never leak entities.
  Key DTOs: `ActivityDto` (has `Kind` — internal activity/event split — `Type`, the scheduling profile, and flat `SetsStateValueIds`/`RequiredStateValueIds`), `OccurrenceDto` (has `EffectiveTitle = title ?? activity.title`, `IsPlanned`, `DurationMinutes`), `RecommendationDto` (always an activity to schedule; `SuggestedStartAt` nullable), `CategoryDto`/`CategorySummaryDto`, `StateDto` (values nested), `CheckpointDto` (has `Size` enum — not numeric progress).
- `Services/*Service.cs` — ctor-inject `StrydeDbContext`; return `Result`/`Result<T>`. Registered in `AddStrydeCore`.
- `Services/RecommendationService.cs` — `LoadStatesAsync` builds the per-state timelines and each
  activity's requirement groups (returns two empty maps when the user has no states, the case that must
  cost nothing). `AllowedIntervals` intersects the groups over the day; `StateAllows` is the gate;
  `AllowedSlots` masks `freeSlots` per activity and every placement branch draws candidates from it.
- `Services/StateService.cs` — state + value CRUD. Invariants: exactly one default per state (the first
  value is forced to be it), the default may not carry a duration, duration 1..`MaxDurationMinutes`,
  deleting a value still referenced returns `Conflict`, deleting the default promotes the oldest
  survivor. Value writes return the whole parent `StateDto`, since an invariant can move the default
  onto a sibling.
- ⚠️ **A child with a pre-set `Guid Id` added to a *tracked* parent's nav collection is treated as an
  existing row** (change detection sees a non-default key) and issues an UPDATE matching nothing. Use
  `db.Set<T>().Add(...)` explicitly — see `StateService.CreateValueAsync` and
  `OccurrenceService.ApplySubtasks`. Relationship fixup then also appends it to the parent collection,
  so guard against adding it twice if you build the response from that collection.
- ⚠️ **SQLite can't `ORDER BY` a `DateTimeOffset` or aggregate a `decimal`** — sort/sum client-side after `ToListAsync`.
  It also **can't translate a `DateTimeOffset` range `WHERE`** (EF throws at execution — stored as offset-bearing
  text, no instant-correct comparison), so occurrence date-window filtering runs in memory too. SQL pre-filters on
  those queries are limited to null checks (e.g. excluding fully-floating rows).

**Backend (`Stryde.Api`)**
- `Program.cs` — registers core services, JWT + auth policy, SPA fallback. JWT config is read
  **eagerly** from `builder.Configuration`: `var jwt = builder.Configuration.GetSection(...).Get<JwtOptions>()`.
  Both `JwtSecurityTokenHandler.DefaultMapInboundClaims = false` and `options.MapInboundClaims = false`
  must be set — the static property alone is not enough.
- `Endpoints/*Endpoints.cs` — thin: parse → service → `result.ToProblem()`. Auth required on all routes except `/api/auth/*`.
  Key endpoint files: `ActivityEndpoints.cs` (`/api/activities`), `OccurrenceEndpoints.cs` (`/api/occurrences`),
  `SettingsEndpoints.cs` (`/api/settings` + `/api/settings/activity-types`),
  `StateEndpoints.cs` (`/api/states` + `/api/states/{stateId}/values`).
- `Endpoints/ApiResults.cs` — `Error.ToProblem()` + `principal.GetUserId()` (reads `sub` claim).

**Frontend (`client/src`)**
- `App.tsx` — auth-gated routing; index → `/plan`.
- `pages/` — `PlanPage`, `CategoriesPage`, `CalendarPage`, `GoalsPage`, `ActivitiesPage`, `InsightsPage`, `SettingsPage`.
- `lib/api.ts` — `request<T>` (bearer + one-shot 401 refresh). Key namespaces: `activitiesApi`, `occurrencesApi`, `categoriesApi`, `goalsApi`, `checkpointsApi`, `insightsApi`, `statesApi`/`stateValuesApi`.
  On `activitiesApi.create`/`update`, **omitting** `setsStateValueIds`/`requiredStateValueIds` leaves them untouched
  and `[]` clears them — which is what lets `BulkAssignModal` resend everything else without knowing about states.
- `lib/types.ts` — mirrors backend DTOs. Key types: `Activity`, `Occurrence` (has `effectiveTitle`), `Recommendation` (flat; `activity` always present), `State`/`StateValue`.
- `lib/theme.ts` — light/dark/system preference (localStorage `stryde-theme`).
- `store/auth.ts` — Zustand; access token in memory only.
- `store/toasts.ts` — Zustand toast store; `toastError(err)` for mutation failures without inline error display.
- `components/ui/` — `Button, Badge, Card(+Header/Title/Content), Modal, Field, ConfirmDialog, ActionMenu, Toasts`.
- `components/events/OccurrenceListRow.tsx` — shared occurrence list row (Plan + Categories): optimistic status toggle, action menu, confirmed delete.
- `components/activities/ActivityListRow.tsx` — activity list row: type tile, meta line, mute toggle, action menu.
  In multi-select mode the tile becomes a checkbox and the row selects instead of navigating. `hideType`/`hideCategory`/`hideGoal`
  drop whatever the current grouping already says in the section header.
- `components/activities/BulkAssignModal.tsx` — sets goal / category / type on a multi-select. No bulk endpoint exists:
  it fans out over `PUT /api/activities/{id}`, resending unchanged fields from each activity (the PUT is a full replace).
- `components/events/SkipRescheduleModal.tsx` — opened after skipping; lets user pick a date and creates a new pending copy on that date.
- `components/goals/OccurrenceBar.tsx` — done/skipped/pending counts bar for ongoing goals on GoalsPage; data from `GoalDto.OccurrenceStats`.
- `components/layout/useUncategorizedCount.ts` — shared nav badge hook (shares `['events', 'all']` cache with CategoriesPage; predicate in `lib/categories.ts`).
- `components/layout/BottomNav.tsx` — mobile nav: 4 tabs + "More" bottom sheet (Activities, Insights, Settings). Max 5 slots; new pages go in the sheet.
- `lib/activityTypes.ts` — labels, icons, and a non-numeric `blurb` per `ActivityType`, plus
  `describeProfile`/`profileHint`, which **generate** the numeric hint copy from a resolved profile.
  Never hardcode a window or block size in client copy: the values are per user.
- `lib/useActivityProfiles.ts` — `['activityProfiles']` query as a `Map<ActivityType, ActivityProfile>`.
- `lib/useStates.ts` — `['states']` query plus `formatStateDuration`, `describeStateValue`,
  `flattenStateValues`.
- `components/activities/StateValuePicker.tsx` — chips grouped by state, the codebase's only
  multi-value picker. `singlePerState` makes a pick replace that state's other selection, which is the
  difference between the "Changes" and "Only suggest when" fields in `ActivityModal`. Both fields are
  hidden entirely until the user has defined a state with values.
- `components/settings/SettingSection.tsx` — `SettingSection`/`SettingRow`/`SectionFooter`/`inputCls`,
  shared by `SettingsPage` and its section editors.
- `components/settings/ActivityTypeSettings.tsx` — per-type window / min block / max/day editor.
  Saves via `PUT /api/settings/activity-types/{type}`, resets via `DELETE`; both return the full
  resolved set, which replaces the cache.
- `components/settings/StateSettings.tsx` — states admin: accordion per state, inline value list with a
  star for the default and an optional expiry in minutes. Every value write returns the whole state,
  which replaces that entry in the `['states']` cache.
- `lib/quotes.ts` — local array of motivational quotes; Plan page picks one by day-of-year.

**Tests**
- `Unit/TestContext.cs` — in-memory SQLite + real services. Naming: `Method_scenario`.
- `Integration/StrydeApiFactory.cs` + `HttpHelpers.cs` — `SetupUserAsync`, `LoginAsync`, `UseBearer`, `ReadAsync<T>`. Fresh factory per class (`IDisposable`).
  ⚠️ **JWT secret in tests:** use `builder.UseSetting("Jwt:Secret", testSecret)` in `ConfigureWebHost` — not `services.Configure<JwtOptions>()`, the eager read already happened.

**EF migrations:** prefix `PATH="$PATH:$HOME/.dotnet/tools"` if `dotnet ef` not found. SQLite only.

## Conventions — follow these

- **Business logic in `Stryde.Core` services.** Endpoints are thin: parse → service → map result.
- **Result pattern, not exceptions.** `Error(ErrorType, msg)` → `error.ToProblem()`
  (Validation→400, NotFound→404, Conflict→409, Unauthorized→401, Forbidden→403).
- **No em dashes in client-facing text.** Use a hyphen, comma, or colon. Code comments are exempt.
- **24h clock everywhere.** Never render AM/PM. Format times as `HH:mm`; native `<input type="time">`
  needs `lang="en-GB"` or the browser falls back to its own locale.
- **Shared validation** in `Common/Validators.cs`. Cross-field rules live in the service.
- **DTOs** in `Core/Dtos/Dtos.cs`; map via `FromEntity`. Don't leak entities.
- **Auth model:** JWT access token in response body (~15 min); 6-month refresh token in httpOnly
  `Secure` cookie (path `/api/auth`), rotated on every refresh. Read user id from `sub` claim
  (`principal.GetUserId()`). Logic in `TokenService.cs`; cookie I/O in `RefreshCookieManager.cs`.
- **Enums as strings** in DB and on the frontend.
- **Theming:** semantic CSS variables in `index.css` → Tailwind via `@theme inline`. Never hardcode
  `bg-slate-*` / `text-*-600`. Dark mode = `.dark` on `<html>`, controlled by `lib/theme.ts`.
- **Day math is server-side.** The client consumes `occurrence.isOverdue`; it never recomputes overdue
  locally. Purely presentational date formatting may stay client-side.
- **Destructive actions confirm via `ConfirmDialog`** (never inline or immediate); mutations without
  inline error display report failures with `toastError` from `store/toasts.ts`. Row dropdowns use
  `components/ui/ActionMenu.tsx` (portal + flip), not hand-rolled absolute menus.
- **Frontend:** `verbatimModuleSyntax` — use `import type` for type-only imports. TanStack Query for
  server state; Zustand for auth (access token in memory).
- **Query keys:** every occurrence list lives under `['events', ...]` (`['events', 'all']` for Categories page + nav
  badge, `['events', 'calendar', ...]` for calendar ranges). After any occurrence write invalidate `['events']`
  and `['recommendations']`. After any activity write invalidate `['activities']` and `['recommendations']`
  (an activity's state requirements decide whether it is suggested at all). After an activity
  type profile write invalidate `['recommendations']` (the engine reads the profiles per request). After any goal write also invalidate `['goals']`.
  States live under `['states']`; after a state or value write invalidate `['states']` and `['recommendations']`.
- **Design:** see `design.md`. Use semantic color tokens, not hardcoded values.

## Gotchas

- **SQLite migrations only.** No Postgres migration set exists.
- **`Jwt:Secret` ≥32 bytes** (`JWT_SECRET` in `.env`); empty in `appsettings.json` by design.
- **`COOKIE_SECURE`** must be `false` for plain-HTTP local dev; `true` in production.
- **Dev port:** `dotnet run` uses `launchSettings.json` (port 5200). Published DLL: set `ASPNETCORE_URLS`.
- **Tests:** in-memory SQLite, kept-open connection, `EnsureCreated()` (not Migrate) in factory. Isolated DB per integration test class.

## Git

**Never run `git commit` unless the user explicitly asks.** Make the changes, stop, and wait.

## Verify changes

`dotnet test` for backend; `cd client && npm run build` for frontend. End-to-end: both dev servers or `docker compose up --build`.
