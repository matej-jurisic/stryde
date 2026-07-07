# CLAUDE.md

Guidance for working in the Stryde repository. See `spec.md` for the full product spec and `plan.md` for the phased implementation plan.

> **Keep the docs in sync.** When you add a feature or change how something works, update `CLAUDE.md`, `spec.md`, and `plan.md` to match. `CLAUDE.md` is the implementation/architecture reference; `spec.md` is the product spec; `plan.md` is the build sequence.

## What this is

Personal operations app built around three primitives: **Events**, **Goals**, and the **Daily Plan**. Single-user initially; schema and auth are multi-user-ready from day one.

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
  Key entities: `User, Event, Goal, Checkpoint, RepeatRule, EventGoal (join), UserSettings`.
  `Event.Status` is `pending | done | skipped`. `Goal.Status` is `focus | active | bench | closed`.
  `Checkpoint.Status` is `pending | reached`.
- `Enums/` — stored as strings (`HasConversion<string>`).
- `Data/StrydeDbContext.cs` — DbSets + `OnModelCreating`. Many-to-many via skip nav (`Event.Goals`).
- `Common/Result.cs` — `Result`/`Result<T>` + `Error(ErrorType, msg)`. **Expected failures = Results, not exceptions.**
- `Common/Validators.cs` — shared static validation rules (incl. `ValidateTimezone`).
- `Common/DayMath.cs` — `DayContext(TimeZoneInfo, TimeOnly)` + pure day-bucketing: `DayOf`, `Today`,
  `EndOfDay`, `EventDay`, `IsOverdue`. **All "which day / overdue?" logic goes through here**, in the
  user's IANA timezone offset by the day boundary. Get a `DayContext` via `UserSettingsService.GetDayContextAsync`.
- `Dtos/Dtos.cs` — request/response records with `FromEntity` static factory. Never leak entities.
  `EventDto.IsOverdue` is computed server-side; the client must not re-derive it.
- `Services/*Service.cs` — ctor-inject `StrydeDbContext`; return `Result`/`Result<T>`. Registered in `AddStrydeCore`.
- `Recurrence/RecurrenceCalculator.cs` — *planned for Phase 9, does not exist yet*; will generate the next occurrence from a `RepeatRule` via `DayMath`.
- ⚠️ **SQLite can't `ORDER BY` a `DateTimeOffset` or aggregate a `decimal`** — sort/sum client-side after `ToListAsync`.

**Backend (`Stryde.Api`)**
- `Program.cs` — registers core services, JWT + auth policy, SPA fallback. JWT config is read
  **eagerly** from `builder.Configuration` (same pattern as Turnly): `var jwt = builder.Configuration.GetSection(...).Get<JwtOptions>()`.
  Both `JwtSecurityTokenHandler.DefaultMapInboundClaims = false` and `options.MapInboundClaims = false`
  must be set — the static property alone is not enough (the `JwtBearerOptions.TokenHandlers` instance
  captures the static value at construction time).
- `Endpoints/*Endpoints.cs` — thin: parse → service → `result.ToProblem()`. Auth required on all routes except `/api/auth/*`.
- `Endpoints/ApiResults.cs` — `Error.ToProblem()` + `principal.GetUserId()` (reads `sub` claim).

**Frontend (`client/src`)**
- `App.tsx` — auth-gated routing; index → `/plan` (Daily Plan — currently a stub, see plan.md Phase 11).
- `pages/` — `PlanPage` (stub), `InboxPage`, `CalendarPage`, `GoalsPage`, `SettingsPage`.
- `lib/api.ts` — `request<T>` (bearer + one-shot 401 refresh).
- `lib/types.ts` — mirrors backend DTOs.
- `lib/theme.ts` — light/dark/system preference (localStorage `stryde-theme`), toggles `.dark` on `<html>`; `initTheme()` runs in `main.tsx`.
- `store/auth.ts` — Zustand; access token in memory only.
- `components/ui/` — `Button, Badge, Card(+Header/Title/Content), Modal, Field`.
- `components/layout/useInboxCount.ts` — shared nav badge hook (shares the `['events', 'all']` cache with InboxPage).

**Tests**
- `Unit/TestContext.cs` — in-memory SQLite + real services. Naming: `Method_scenario`.
- `Integration/StrydeApiFactory.cs` + `HttpHelpers.cs` — `SetupUserAsync`, `LoginAsync`, `UseBearer`, `ReadAsync<T>`. Fresh factory per class (`IDisposable`).
  ⚠️ **JWT secret in tests:** use `builder.UseSetting("Jwt:Secret", testSecret)` in `ConfigureWebHost`.
  This feeds into `builder.Configuration` before Program.cs reads it eagerly. Do NOT use
  `services.Configure<JwtOptions>(...)` override — the eager read already happened by then.

**EF migrations:** prefix `PATH="$PATH:$HOME/.dotnet/tools"` if `dotnet ef` not found. SQLite only.

## Conventions — follow these

- **Business logic in `Stryde.Core` services.** Endpoints are thin: parse → service → map result.
- **Result pattern, not exceptions.** `Error(ErrorType, msg)` → `error.ToProblem()`
  (Validation→400, NotFound→404, Conflict→409, Unauthorized→401, Forbidden→403).
- **No em dashes in client-facing text.** Use a hyphen, comma, or colon. Code comments are exempt.
- **Shared validation** in `Common/Validators.cs`. Cross-field rules live in the service.
- **DTOs** in `Core/Dtos/Dtos.cs`; map via `FromEntity`. Don't leak entities.
- **Auth model:** JWT access token in response body (~15 min); 6-month refresh token in httpOnly
  `Secure` cookie (path `/api/auth`), rotated on every refresh. Read user id from `sub` claim
  (`principal.GetUserId()`). Logic in `TokenService.cs`; cookie I/O in `RefreshCookieManager.cs`.
- **Enums as strings** in DB and on the frontend (e.g. `GoalStatus = 'focus' | 'active' | 'bench' | 'closed'`).
- **Theming:** semantic CSS variables in `index.css` → Tailwind via `@theme inline`. Never hardcode
  `bg-slate-*` / `text-*-600`. Dark mode = `.dark` on `<html>`, controlled by `lib/theme.ts`
  (light/dark/system on the Settings page, persisted in localStorage).
- **Day math is server-side.** Anything that decides "which day is this / is this overdue / what is today"
  uses `DayMath` + `DayContext` in the user's timezone. The client consumes `event.isOverdue`; it never
  recomputes overdue locally. Purely presentational date formatting (labels, grouping headers) may stay client-side.
- **Frontend:** `verbatimModuleSyntax` — use `import type` for type-only imports. TanStack Query for
  server state; Zustand for auth (access token in memory).
- **Query keys:** every event list lives under the `['events', ...]` prefix (`['events', 'all']` for
  Inbox + nav badge, `['events', 'calendar', ...]` for calendar ranges). After any event write invalidate
  `['events']` and `['recommendations']`. After any goal write invalidate `['goals']`, `['events']`, and
  `['recommendations']` (goal titles/statuses are embedded in event DTOs and drive tiers).

## Design language

See `design.md` for the full visual spec. Summary of key decisions:

- **Three-pane layout.** Fixed left sidebar 240px (`md:`+), recommendations column 320px, fluid canvas. Below `md` → drawer.
- **Color:** light-gray canvas (`--background` `#f3f4f6`), white cards/panels (`--card` `#ffffff`). Primary brand: vibrant purple (`--primary` `#8b5cf6`). Borders: `#e5e7eb`.
- **Active nav state:** `bg-accent` (gray tint) + `font-semibold` text. NOT a primary-color tint. Hover: `bg-accent`.
- **Shadows: strictly flat.** No shadow on cards or internal elements. Only `shadow-pop` on modals and floating menus.
- **Status pills** via `Badge`: soft `color-mix` bg + saturated text. Tones: `neutral | violet | red | blue | amber | green`.
- **Corners:** 6-8px buttons/tags, 8-12px cards/modals (`--radius-md/lg/xl`).
- **Typography:** Inter, regular body / semibold headers. Don't bold body, labels, or buttons.
- **Icons:** outline/stroke, 2px stroke-width, `currentColor`.
- **Goal status colors:** Focus = purple/pink, Active = teal/blue, Bench = neutral gray.
- **Sidebar:** Stryde brand in `text-primary`. Main nav items in middle. Settings pinned to bottom.

## Key domain rules

- **Floating events** (no `StartAt`) live in Inbox. Not overdue, no urgency signal.
- **An event belongs to the day it starts on** (user timezone, day-boundary-adjusted). Cross-midnight
  events are not split; the calendar renders them on their start day, clamped.
- **Overdue:** pending, and `EndAt` passed, or `StartAt`-only and the event's day has ended (day boundary
  on the following date, user timezone). Computed in `DayMath.IsOverdue`, exposed as `EventDto.IsOverdue`.
- **Focus limit:** moving a goal to `focus` is blocked if `UserSettings.MaxFocusGoals` is already reached — `Conflict` error.
- **Checkpoint cap:** a goal's checkpoints may not plan more than 100% total progress — `Validation` error
  (cross-field rule in `CheckpointService`).
- **Repeat on complete/skip:** generate next instance immediately with same rule and goal links; current marked done/skipped.
- **Repeat delete scope:** `this` (current instance only) or `future` (current + all future). Always prompt on frontend.
- **Recommendation ranking (7 tiers):**
  1. Events due today, not yet done
  2. Overdue events
  3. Events linked to Focus goals with lagging actual progress
  4. Events linked to Active goals with lagging actual progress
  5. Floating events linked to Focus goals
  6. Floating events linked to Active goals
  7. Floating events linked to Bench goals (only when nothing above exists)
  Within each tier: sort by due date asc, then duration asc (shorter first).
- **Goal progress — believed:** sum of `PlannedProgress` of all `reached` checkpoints.
- **Goal progress — actual:** count of completed linked events × fixed increment (v1: each completion = fixed increment, exact value TBD in Phase 10).
- **Day boundary:** user-configurable time at which "today" rolls over (default midnight). Stored in
  `UserSettings.DayBoundaryTime`; applied everywhere via `DayMath` (a day runs boundary to boundary).

## Gotchas

- **SQLite migrations only.** No Postgres migration set exists.
- **`Jwt:Secret` ≥32 bytes** (`JWT_SECRET` in `.env`); empty in `appsettings.json` by design.
- **`COOKIE_SECURE`** must be `false` for plain-HTTP local dev; `true` in production.
- **Dev port:** `dotnet run` uses `launchSettings.json` (port 5200). Published DLL: set `ASPNETCORE_URLS`.
- **Tests:** in-memory SQLite, kept-open connection, `EnsureCreated()` (not Migrate) in factory. Isolated DB per integration test class.

## Verify changes

`dotnet test` for backend; `cd client && npm run build` for frontend. End-to-end: both dev servers or `docker compose up --build`.
