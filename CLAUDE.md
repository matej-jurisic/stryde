# CLAUDE.md

Working guide for the Stryde repository.
- **`spec.md`** — product spec: what the app does, domain rules, data model fields.
- **`design.md`** — visual/UX spec.

## Doc sync rule

**After every feature or meaningful change, update the docs before closing the task.**

- `CLAUDE.md` — update the file map or conventions if the codebase structure changed.
- `spec.md` — update if product behaviour, domain rules, or the data model changed.
- `design.md` — update if the UI or visual language changed.

There is no build-history doc: `spec.md` describes the app as it is now, in the present tense, with no
record of what it used to do or what is planned. Git history is the changelog. Reasoning worth keeping
belongs in a code comment next to the thing it explains, not in a doc of past decisions.

Keep `CLAUDE.md` small: it is a navigation and convention guide, not a product spec. Domain rules belong in `spec.md`; visual rules belong in `design.md`.

## What this is

A brain space for goals, deadlines and motivation, built around **Goals**, **Activities** and
**Occurrences**. Single-user initially; schema and auth are multi-user-ready from day one.

**The app does not ask the user to log their life.** No suggestion engine, no scheduling model, no
stat with a 24-hour denominator - so sleep, work and commuting need never be entered, and nothing
computes a wrong answer when they are missing. Before adding anything, apply the test in `spec.md`:
*does this still produce a correct answer if the user logs only what they care about?* Free-slot
placement, availability inference, and "unaccounted time" all fail it. The calendar is a
visualization and a fast way to add things, not a planner.

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
  Entities: `User, Activity, Occurrence, Goal, Checkpoint, Category, UserSettings, ActivitySubtask,
  OccurrenceSubtask` (subtasks are two levels: `ActivitySubtask` is the title-only template, copied
  into `OccurrenceSubtask` rows — which carry `IsDone` — when an occurrence is created).
- `Enums/` — stored as strings (`HasConversion<string>`).
- `Data/StrydeDbContext.cs` — DbSets + `OnModelCreating`. `Occurrence → Activity` cascade delete; `Activity → Category/Goal` set-null.
- `Common/Result.cs` — `Result`/`Result<T>` + `Error(ErrorType, msg)`. **Expected failures = Results, not exceptions.**
- `Common/Validators.cs` — shared static validation rules.
- `Common/DayMath.cs` — all "which day / is this overdue?" logic goes through here, in the user's IANA
  timezone offset by `DayBoundaryTime`. Get a `DayContext` via `UserSettingsService.GetDayContextAsync`.
  Key methods: `OccurrenceDay(Occurrence, DayContext)`, `IsOverdue(Occurrence, DayContext, DateTimeOffset)`.
- `Dtos/Dtos.cs` — request/response records with `FromEntity` static factory. Never leak entities.
  Key DTOs: `ActivityDto` (has `Kind` — internal activity/event split), `OccurrenceDto` (has
  `EffectiveTitle = title ?? activity.title`, `IsPlanned`, `DurationMinutes`),
  `CategoryDto`/`CategorySummaryDto`, `CheckpointDto` (has `Size` enum — not numeric progress).
- `Services/*Service.cs` — ctor-inject `StrydeDbContext`; return `Result`/`Result<T>`. Registered in `AddStrydeCore`.
- `Services/InsightsService.cs` — totals over completed occurrences only. **Never add a stat whose
  denominator is the length of a day**; see the boundary above.
- ⚠️ **A child with a pre-set `Guid Id` added to a *tracked* parent's nav collection is treated as an
  existing row** (change detection sees a non-default key) and issues an UPDATE matching nothing. Use
  `db.Set<T>().Add(...)` explicitly — see `OccurrenceService.ApplySubtasks`. Relationship fixup then also appends it to the parent collection,
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
  `SettingsEndpoints.cs` (`/api/settings`), `InsightsEndpoints.cs` (`/api/insights`).
- `Endpoints/ApiResults.cs` — `Error.ToProblem()` + `principal.GetUserId()` (reads `sub` claim).

**Frontend (`client/src`)**
- `App.tsx` — auth-gated routing; index → `/plan`.
- `pages/` — `PlanPreviewPage` (**this is `/plan`**), `CalendarPage`, `CategoriesPage`,
  `GoalsPreviewPage` (**this is `/goals`**), `GoalDetailPage`, `ActivitiesPage`, `ActivityDetailPage`,
  `InsightsPage`, `SettingsPage`. The `*PreviewPage` names are historical — they are the live pages.
  `/activities`'s static segment outranks `/activities/:id`.
- `lib/api.ts` — `request<T>` (bearer + one-shot 401 refresh). Key namespaces: `activitiesApi`, `occurrencesApi`, `categoriesApi`, `goalsApi`, `checkpointsApi`, `insightsApi`.
- `lib/types.ts` — mirrors backend DTOs. Key types: `Activity`, `Occurrence` (has `effectiveTitle`), `Goal`, `Category`, `Insights`.
- `lib/theme.ts` — light/dark/system preference (localStorage `stryde-theme`).
- `store/auth.ts` — Zustand; access token in memory only.
- `store/toasts.ts` — Zustand toast store; `toastError(err)` for mutation failures without inline error display.
- `components/ui/` — `Button, Badge, Card(+Header/Title/Content), Modal, Field, ConfirmDialog, ActionMenu, Toasts`,
  plus `input.ts` (`inputCls`, the bare input/select treatment; `SettingSection` re-exports it).
- `components/events/OccurrenceListRow.tsx` — shared occurrence list row (Plan + Categories): optimistic status toggle, action menu, confirmed delete.
- `components/activities/ActivityListRow.tsx` — activity list row: leading tile in the **category's**
  colour and icon (via `CategoryIcon`), meta line, action menu (history / edit / delete).
  In multi-select mode the tile becomes a checkbox and the row selects instead of navigating.
  `hideCategory`/`hideGoal` drop whatever the current grouping already says in the section header.
- `components/activities/BulkAssignModal.tsx` — sets goal / category on a multi-select. No bulk endpoint exists:
  it fans out over `PUT /api/activities/{id}`, resending unchanged fields from each activity (the PUT is a full replace).
- `components/events/SkipRescheduleModal.tsx` — opened after skipping; lets user pick a date and creates a new pending copy on that date.
- `components/goals/OccurrenceBar.tsx` — done/skipped/pending counts bar for ongoing goals; data from `GoalDto.OccurrenceStats`.
- `components/layout/useUncategorizedCount.ts` — nav badge hook (shares `['events', 'all']` cache with CategoriesPage;
  predicate in `lib/categories.ts`). Currently unreferenced: neither nav renders a badge.
- `components/layout/Sidebar.tsx` — desktop nav: five page items, then the category list (`Active` =
  `/categories?all=true`, `No category`, one per category with inline add/edit/delete), Settings pinned at the bottom.
- `components/layout/BottomNav.tsx` — mobile nav: 4 tabs + "More" bottom sheet (Activities, Insights, Settings). Max 5 slots; new pages go in the sheet.
- `components/activities/ActivityHistoryModal.tsx` — read-only "have I been doing this", opened from an
  activity row's action menu. Reads `['events', 'activity', id]`, the same key `ActivityDetailPage`
  fills, so the two warm each other. **Every figure is derived in the component** from that activity's
  own occurrences (`summarise`): last done, median gap between completion *days*, modal quarter-hour
  start, median measured length. Nothing is passed in, so any caller can open it with just an activity,
  and no figure needs a complete calendar to be right.
- `pages/CalendarPage.tsx` — ⚠️ **plain click / tap on empty grid creates** (`openCreateAt`,
  `CLICK_CREATE_MINUTES`), reached from the mouse no-drag path and the touch tap in
  `handleGridPointerUp`. Drag still sets an exact span; long press does it on touch.
  The touch tap is guarded by four clauses (`TAP_MAX_MS`, `SCROLL_SETTLE_MS`, no latched swipe,
  unchanged `scrollTop`) because a scrolling finger produces near-taps constantly, and the mouse path
  additionally requires `lastPointerTypeRef.current === 'mouse'`: a touch reaches it a second time as a
  compatibility mouse event, which would otherwise walk straight past all four.
- `lib/timeScale.ts` — the grid's minute↔pixel map, one `TimeScale` per visible day. `linearScale` is
  the plain 0-24 map; `compactScale` elides empty stretches into fixed-height bands. **Every grid
  coordinate goes through `toPx`/`toMin`** — event tops, hour lines, overlays, the now line, snapping
  (`snapToGrid` takes the scale, not `hourPx`). Two invariants the calendar leans on:
  1. **Any drag expands first.** `expandForDrag` swaps in the linear scale via `flushSync` before the
     gesture reads a coordinate, so no drag code reasons about bands; `collapseAfterDrag` in each
     gesture's `cleanup` restores it. Collapsing is a plain `setState`, so the drop still reads
     expanded geometry. Expansion fires at each gesture's *commit* point (mouse drag threshold, touch
     long press, resize-handle press), never on pointerdown — that would flicker on every click.
  2. **An event's own span always sits inside one expanded segment**, so pixel offsets measured within
     a block (grab offset, block height) survive the switch untouched. Only absolute tops are
     re-derived, from `startMin`, which is why `dragRef` carries it.
  ⚠️ Scroll position is corrected by `captureAnchor` + the anchor `useLayoutEffect`, not by the
  caller: record the minute to hold still *before* any state is queued, apply it after layout. Zoom
  and the compact toggle use it too. Three things about it are load-bearing:
  - **Capture before queueing state.** It converts a pixel to a minute through the *current* scale,
    and in a compacted one a 20px band spans hours — measuring after the grid has moved (the FLOAT /
    all-day rows appear on drag start) turns a ~150px shift into a several-hour error.
  - **The anchor is not one-shot.** One gesture moves the grid across more than one render, and which
    render gets what depends on React's batching. Re-applying drives the delta to zero, so it is left
    in place and every render converges. It expires after `ANCHOR_TTL_MS` instead of being consumed.
  - **`dragSpacerRef`.** Holding a minute in place needs the scroll range to reach it; with the
    compact grid shorter than the viewport there is none, so the browser clamps and the grid lurches
    by the shortfall. The spacer adds a viewport of room under the grid while `dragExpanded`.
- `components/settings/SettingSection.tsx` — `SettingSection`/`SettingRow`/`SectionFooter`, the layout
  primitives `SettingsPage` is built from. Settings holds preferences only.
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
  badge, `['events', 'calendar', ...]` for calendar ranges, `['events', 'activity', id]` for one activity's history).
  After any occurrence write invalidate `['events']`. After any activity write invalidate `['activities']`
  **and `['events']`** (occurrences embed their activity: its title feeds `effectiveTitle` and its category
  feeds every row and calendar block's colour). After any goal write also invalidate `['goals']`.
- **Design:** see `design.md`. Use semantic color tokens, not hardcoded values.

## Gotchas

- ⚠️ **`border-*` colour utilities do nothing.** `index.css` sets `border-color: var(--border)` on
  `*, *::before, *::after` **outside any layer**, and unlayered CSS outranks all of `@layer utilities`,
  so `border-primary`, `border-transparent`, `border-border/40` etc. are silently dead app-wide. Set
  border colours inline (`style={{ borderTopColor: ... }}`) until that rule moves into `@layer base` —
  moving it activates ~68 dormant utilities at once, which is a deliberate visual change, not a no-op.
- **SQLite migrations only.** No Postgres migration set exists.
- ⚠️ **Guids are UPPER-case TEXT in SQLite.** Microsoft.Data.Sqlite binds a `Guid` parameter as
  upper-case text and SQLite compares text case-sensitively, so raw SQL in a migration that mints an
  id must produce upper-case (`hex()` already does; don't `lower()` it). A lower-case id lists fine -
  `Guid.Parse` ignores case - but matches nothing by key, so update, delete and FK lookups all 404.
  `MigrationTests` guards this by querying seeded rows by id, not just listing them.
- **`dotnet ef database update` does not touch the app's database.** `StrydeDbContextFactory` points
  design-time tooling at `stryde-design.db`; `src/Stryde.Api/stryde.db` is migrated by the API on
  startup (`Database:MigrateOnStartup`), so restart the API to apply a new migration to dev data.
- **`Jwt:Secret` ≥32 bytes** (`JWT_SECRET` in `.env`); empty in `appsettings.json` by design.
- **`COOKIE_SECURE`** must be `false` for plain-HTTP local dev; `true` in production.
- **Dev port:** `dotnet run` uses `launchSettings.json` (port 5200). Published DLL: set `ASPNETCORE_URLS`.
- **Tests:** in-memory SQLite, kept-open connection, `EnsureCreated()` (not Migrate) in factory. Isolated DB per integration test class.

## Git

**Never run `git commit` unless the user explicitly asks.** Make the changes, stop, and wait.

## Verify changes

`dotnet test` for backend; `cd client && npm run build` for frontend. End-to-end: both dev servers or `docker compose up --build`.
