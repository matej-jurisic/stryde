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
  Key entities: `User, Activity, Occurrence, Goal, Checkpoint, Category, UserSettings, ActivityType,
  State, StateValue, ActivityStateEffect, ActivityStateRequirement, UnaccountedTimeRequirement,
  ActivitySubtask, OccurrenceSubtask`
  (subtasks are two levels: `ActivitySubtask` is the title-only template, copied into
  `OccurrenceSubtask` rows — which carry `IsDone` — when an occurrence is created.)
  (the last three are link/child rows keyed by their contents, not by a `Guid Id`: `StateValue` is a
  normal child of `State`, while `ActivityStateEffect` keys on `(ActivityId, StateId)` — one value per
  state, structurally — and `ActivityStateRequirement` on `(ActivityId, StateValueId)` — many per state,
  ORed within a state and ANDed across them, and `UnaccountedTimeRequirement` on
  `(UserId, StateValueId)` - the same requirement shape hung off `UserSettings`, read only by
  `InsightsService`.)
  `ActivityStateEffect.DurationMinutes` is how long the value holds: it belongs to the **cause**, not
  the value, since a run leaves you tired for ten hours and a hike for two days.
- `Enums/` — stored as strings (`HasConversion<string>`).
- `Data/StrydeDbContext.cs` — DbSets + `OnModelCreating`. `Occurrence → Activity` cascade delete; `Activity → Category/Goal/ActivityType` set-null.
- `Common/Result.cs` — `Result`/`Result<T>` + `Error(ErrorType, msg)`. **Expected failures = Results, not exceptions.**
  `ErrorType.Unavailable` is for a dependency outside the app that did not answer - today only the
  user's own model server. Neither a bug nor the user's mistake, so neither 500 nor 400: it maps to
  **503**, and every caller is expected to carry on without the feature.
- `Common/Validators.cs` — shared static validation rules.
- `Common/ActivityProfiles.cs` — `ActivityProfile`, the scheduling numbers flattened off an
  `ActivityType` row so the engine never holds an entity, plus `Unconstrained` (what an activity with
  **no** type gets), the `DefaultWindow*` pair a new type row starts at, and two engine constants.
  `Unconstrained`'s window is **null, not wide**: a window's end is a hard placement limit, so any
  default window would be a constraint the "No type" label denies having. Keep it null. There is no default table any more: types are user rows,
  so nothing needs reconciling against a built-in. `ActivityTypeService.ResolveAsync` returns the
  user's profiles keyed by id; a missing key is `Unconstrained`.
  **Types hold scheduling numbers only** — no type refers to another type, and conditions belong to
  States. Don't add a field that names a real-life thing (work, commute) instead of a scheduling
  behaviour.
- `Common/StateTimeline.cs` — folds `StateSetter`s into a state's piecewise value over time, and
  answers `IntervalsWhere(allowedValueIds, from, to)` for the engine's gate and `SegmentAt(instant)`
  for a snapshot (value + when it began + when it ends). Nothing about a state is persisted: the value at
  an instant is derived from the schedule, so moving an occurrence moves the state with it. A setter
  fires at its occurrence's **end** (`EndAt ?? StartAt`); the setting **effect's** `DurationMinutes`
  decays it back to the state default, so one value can be held for different lengths by different
  activities. A later setter that *changes* the value replaces the pending expiry; one that re-sets the
  value already in force takes whichever expiry is further out. See `spec.md` → States.
- `Common/Intervals.cs` — `Intersect`/`Complement`/`Merge` over `(Start, End)` lists. The one place
  time-range set algebra lives: the engine ANDs state requirements with it, `InsightsService` masks a
  day with it. Inputs are assumed sorted and disjoint except for `Merge`, which is the door raw
  occurrence spans come in through.
- `Common/DayMath.cs` — all "which day / is this overdue?" logic goes through here, in the user's IANA
  timezone offset by `DayBoundaryTime`. Get a `DayContext` via `UserSettingsService.GetDayContextAsync`.
  Key methods: `OccurrenceDay(Occurrence, DayContext)`, `IsOverdue(Occurrence, DayContext, DateTimeOffset)`.
- `Dtos/Dtos.cs` — request/response records with `FromEntity` static factory. Never leak entities.
  Key DTOs: `ActivityDto` (has `Kind` — internal activity/event split — `Type`, the scheduling profile, `SetsStateValues` — `(StateValueId, DurationMinutes)` pairs — and flat `RequiredStateValueIds`), `OccurrenceDto` (has `EffectiveTitle = title ?? activity.title`, `IsPlanned`, `DurationMinutes`), `RecommendationDto` (always an activity to schedule; `SuggestedStartAt` nullable, `UnlockedBy` set only in chained mode), `CategoryDto`/`CategorySummaryDto`, `StateDto` (values nested), `CheckpointDto` (has `Size` enum — not numeric progress).
- `Services/*Service.cs` — ctor-inject `StrydeDbContext`; return `Result`/`Result<T>`. Registered in `AddStrydeCore`.
- `Services/RecommendationService.cs` — `committedOccurrences` is the one list every day-contents
  decision reads (suppression, type caps, free slots, state setters), so what is filtered out of it is
  invisible to the engine: skipped occurrences, and **all-day + planned** ones, which say only
  "sometime that day" (`IsAllDay` alone is a date commitment, `IsPlanned` alone a window - both count).
  `ComputeStats` and `ActivityStats` are **public**: `CaptureService` reads them too, so the habitual
  start time a note is filled in with is the one a suggestion would be placed at.
  `ComputeStats` separately ignores all-day rows for the habitual start time and span-derived duration:
  midnight is not a start time. The habitual start is the fullest ±20min cluster of observed starts,
  indexed **from the day boundary** so late-night and post-midnight sessions are neighbours, and it is
  withheld entirely below `MinStartTimeSupport`/`MinStartTimeShare` - it overrides a type's window and
  can cost a suggestion its slot, so it must not be earned by one completion. See `spec.md` →
  Recommendations.
  The per-state timelines and each activity's requirement groups come from
  `StateService.LoadContextAsync` (`StateContext.Empty` when the user has no states, the case that must
  cost nothing). `AllowedIntervals` intersects the groups over the day; `StateAllows` is the gate;
  `AllowedSlots` masks `freeSlots` per activity and every placement branch draws candidates from it.
  ⚠️ **`candidates` is rank order; `ByPlacement` is placement order** — habit-anchored first, then the
  rest, `OrderBy` being stable so rank survives inside each group. Rank still owns the returned list
  (hence the `rank` index and the final `OrderBy`) and the order type caps are consumed in. Placing in
  rank order let two habitless suggestions fill the 08:00 fallback and knock a real 08:00 habit off its
  own hour, which in chained mode took out the entire day that habit unlocks.
  The `chain` parameter picks between two loops over that list. Strict admits by cap in rank order,
  then places; **chained** defers `StateAllows`/`FitsASlot` into the loop (`StateFiltersPass` is the
  switch), because what a candidate may do depends on where the ones before it landed - each placement
  calls `FoldIn`, which appends a provisional `StateSetter` and rebuilds the timelines, then the scan
  **restarts from the top**. A candidate leaves `pending` only when it is actually placed: finding no
  room is not a verdict, since a later leg can put the state back (hence `HasTypeSlot` split off
  `TakeTypeSlot`, so a failed attempt does not spend the cap). Leftovers surface timeless or are
  dropped. `RevocationFloor` is the other half: a suggestion that takes a state out of a value
  something else still needs may not start before that thing ends - without it a habitless trip home
  lands right after the trip in and closes the working day. It reads two sources. `placedByActivity`
  is the chained half, suggestions placed above this one. `committedClaims` is the day's own
  occurrences, and applies in **both** modes: a committed occurrence's requirements are otherwise
  inert, since they are read only to decide whether that activity may be *suggested* and never again
  once it is on the calendar - which let a 07:00 commute be proposed on a work-from-home day. It is
  built off `dayBlocks`, so what blocks time is exactly what holds states.
  The closing sweep is the backstop for what
  the floor cannot see. `UnlockedBy` names only setters into a value the activity *accepts*, so a
  revoker is never reported as the reason something surfaced.
  See `spec.md` → Recommendations → Suggestion mode.
- `Services/ActivityTypeService.cs` — type CRUD, `ResolveAsync` for the engine, and
  `SeedDefaultsAsync`/`DefaultsFor`, which `AuthService.RegisterAsync` calls (types cannot fall back
  to a built-in table the way `UserSettings` does — the rows *are* the list). Anything seeded must be
  expressible in the editor's cadence/cooldown dropdowns, or a built-in becomes unreachable by hand.
- `Services/StateService.cs` — state + value CRUD, plus the two readers of the schedule:
  `LoadContextAsync` (the `StateContext` the recommendation engine's gate uses - timelines, per-activity
  requirement groups, and the setters' origins) and `SnapshotAsync` (what every state held at one
  instant and why, for the calendar dialog). `SetsState` is the one predicate for "does this occurrence
  set state", so the engine and a snapshot can't disagree about it. `StateContext` also carries
  `EffectsByActivity`/`SettersByState`/`DefaultValueByState` and `Rebuild(extra)`, which folds in
  setters for things that have **not** happened — the whole of chained suggestions, and the reason the
  raw setters are kept alongside the already-folded `Timelines`.
  Invariants: exactly one default per state (the first
  value is forced to be it), deleting a value still referenced returns `Conflict`, deleting the default
  promotes the oldest survivor. Value writes return the whole parent `StateDto`, since an invariant can
  move the default onto a sibling. **Durations are not here** — they live on the effect, so
  `ActivityService.ApplyStatesAsync` validates them via `Validators.ValidateStateDuration`
  (1..`MaxStateDurationMinutes`, and none on a change to the state's default value).
- `Services/InsightsService.cs` — `GetAsync` folds a day into "which stretches counted and had
  nothing in them", and the average, the largest gaps and the often-empty hours are all read off that
  one list. The **unaccounted-time mask** (`UserSettingsService.GetUnaccountedMaskAsync`) is applied by
  folding the day's *non*-counted stretches in with the busy spans, so one change removes them from
  all three at once; a tracked day the mask empties is dropped rather than scored as zero. No mask
  (the default) skips the state machinery entirely. `GetEmptyProfileAsync` is separate and unmasked -
  it answers "when are you usually free" for the calendar overlay, on plain calendar days.
- `Llm/` — the seam to a model the user runs themselves. `ILlmClient` (+ `LlmCompletion`, which
  carries the server's own timing counters), `OllamaLlmClient` over Ollama's native `/api/chat`
  (**not** the OpenAI-compatible route: the native one takes a raw JSON Schema in `format` and
  returns those counters), and `LlmOptions`, resolved per call off the user's settings row rather
  than injected - the address and model are settings, so the client is a stateless singleton over one
  `HttpClient` with no BaseAddress, and per-call deadlines are linked tokens rather than
  `HttpClient.Timeout`, which is instance-wide.
  ⚠️ **Output tokens dominate the cost** of a local call - roughly 4-5x an input token on CPU
  inference - so every call passes a JSON schema *and* a tight `maxOutputTokens`. An unconstrained
  reply is minutes, not seconds. `think: false` is sent only when the user asks for it: a model with
  no thinking mode rejects the field outright.
- `Services/CaptureService.cs` — natural-language capture. Returns a `CaptureDraftDto` and **writes
  nothing**: the client opens the draft in `EventModal` and the user creates it through the normal
  endpoints. The model is given no timezone and no arithmetic - it returns a plain local date and
  clock time and this class builds the instants, since date maths is what it is worst at.
  Activity names match **exactly** (ignoring case/space) and nothing looser; a substring match would
  point an occurrence at the wrong activity and corrupt its cadence, habitual start and every
  suggestion drawn from it.
  A note that names a day but no time is filled in from the matched activity's habitual hours via
  `RecommendationService.ComputeStats` — **called, not reimplemented**, so a captured note and a
  suggested slot cannot quote different figures for the same routine. It beats the model's `allDay`
  flag; date-only is the fallback when there is no habit to read. See `spec.md` → Assistant.
- `Services/ExportService.cs` + `Services/ExportMarkdown.cs` — the export loads the whole account and
  renders it as **one Markdown document**, not JSON. It has no DTOs and no import path, so the writer
  is free to drop ids, name everything, and turn stored numbers into the sentences the UI uses. Any
  new user-facing field belongs in `ExportMarkdown` too, phrased for someone who has never seen the
  app. See `spec.md` → Settings → Data export.
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
  `SettingsEndpoints.cs` (`/api/settings`), `ActivityTypeEndpoints.cs` (`/api/activity-types`),
  `StateEndpoints.cs` (`/api/states` + `/api/states/snapshot?at=` + `/api/states/{stateId}/values`),
  `LlmEndpoints.cs` (`/api/llm/status` + `/api/llm/capture`).
- `Endpoints/ApiResults.cs` — `Error.ToProblem()` + `principal.GetUserId()` (reads `sub` claim).

**Frontend (`client/src`)**
- `App.tsx` — auth-gated routing; index → `/plan`.
- `pages/` — `PlanPreviewPage` (**this is `/plan`**), `CalendarPage`, `CategoriesPage`,
  `GoalsPreviewPage` (**this is `/goals`**), `GoalDetailPage`, `ActivitiesPage`, `ActivityDetailPage`,
  `ActivityTypesPage`, `StatesPage`, `InsightsPage`, `SettingsPage`. `PlanPage` and `GoalsPage` are the
  previous layouts, still routed at `/plan-old` and `/goals-old` — check which file a route actually
  renders before editing either pair.
  The three activity routes are one screen in three tabs: `/activities`, `/activities/types`,
  `/activities/states`. Types and states are user vocabulary, not app preferences, so they live here
  rather than in Settings. Their static segments outrank `/activities/:id`.
- `lib/api.ts` — `send` (bearer + one-shot 401 refresh) under `request<T>` for JSON and `requestText`
  for the Markdown export. Key namespaces: `activitiesApi`, `occurrencesApi`, `categoriesApi`, `goalsApi`, `checkpointsApi`, `insightsApi`, `statesApi` (incl. `snapshot(atIso)`)/`stateValuesApi`, `activityTypesApi`, `exportApi`.
  Key namespaces also include `llmApi` (`status`, `capture`).
  On `activitiesApi.create`/`update`, **omitting** `setsStateValues`/`requiredStateValueIds` leaves them untouched
  and `[]` clears them — which is what lets `BulkAssignModal` resend everything else without knowing about states.
  `settingsApi.update` follows the same contract for `unaccountedStateValueIds` **and for every `llm*`
  field**, so a caller editing the day boundary cannot switch the assistant off by not knowing it
  exists; `""` clears `llmBaseUrl`/`llmModel`.
- `lib/types.ts` — mirrors backend DTOs. Key types: `Activity` (has `activityTypeId` plus an embedded `type` summary), `Occurrence` (has `effectiveTitle`), `Recommendation` (flat; `activity` always present), `State`/`StateValue`, `StateSnapshot`/`StateSnapshotEntry`, `ActivityType`.
- `lib/theme.ts` — light/dark/system preference (localStorage `stryde-theme`).
- `store/auth.ts` — Zustand; access token in memory only.
- `store/toasts.ts` — Zustand toast store; `toastError(err)` for mutation failures without inline error display.
- `store/suggestionMode.ts` — `'strict' | 'chained'`, localStorage-backed. Read by the panel and by
  `CalendarPage`'s ghost queries, which is what makes one toggle move both. It is part of the query
  key rather than an invalidation trigger, so both readings of a day stay cached.
- `components/ui/` — `Button, Badge, Card(+Header/Title/Content), Modal, Field, ConfirmDialog, ActionMenu, Toasts`,
  plus `input.ts` (`inputCls`, the bare input/select treatment; `SettingSection` re-exports it).
- `components/events/OccurrenceListRow.tsx` — shared occurrence list row (Plan + Categories): optimistic status toggle, action menu, confirmed delete.
- `components/activities/ActivityListRow.tsx` — activity list row: type tile, meta line, mute toggle, action menu.
  In multi-select mode the tile becomes a checkbox and the row selects instead of navigating. `hideType`/`hideCategory`/`hideGoal`
  drop whatever the current grouping already says in the section header.
- `components/activities/BulkAssignModal.tsx` — sets goal / category / type on a multi-select. No bulk endpoint exists:
  it fans out over `PUT /api/activities/{id}`, resending unchanged fields from each activity (the PUT is a full replace).
- `components/events/SkipRescheduleModal.tsx` — opened after skipping; lets user pick a date and creates a new pending copy on that date.
- `components/goals/OccurrenceBar.tsx` — done/skipped/pending counts bar for ongoing goals on GoalsPage; data from `GoalDto.OccurrenceStats`.
- `components/layout/useUncategorizedCount.ts` — nav badge hook (shares `['events', 'all']` cache with CategoriesPage;
  predicate in `lib/categories.ts`). Currently unreferenced: neither nav renders a badge.
- `components/layout/Sidebar.tsx` — desktop nav: five page items, then the category list (`Active` =
  `/categories?all=true`, `No category`, one per category with inline add/edit/delete), Settings pinned at the bottom.
- `components/layout/BottomNav.tsx` — mobile nav: 4 tabs + "More" bottom sheet (Activities, Insights, Settings). Max 5 slots; new pages go in the sheet.
- `lib/activityTypes.ts` — `describeProfile`/`profileHint`, which **generate** the numeric hint copy
  from a type row, plus `CADENCE_OPTIONS`/`COOLDOWN_OPTIONS` (the only values those two fields may
  hold, since the editor offers them as words) and the "no type" label and hint.
  Never hardcode a window or block size in client copy: every value is the user's own.
- `lib/useActivityTypes.ts` — `['activityTypes']` query; `useActivityTypeMap` keys it by id.
- `components/activities/ActivityTypeIcon.tsx` — a type's stored lucide name through the shared
  `ICON_MAP`, degrading to a neutral outline for an unknown key and for no type at all. Also exports
  `TYPE_ICON_NAMES`, the short curated slice the type editor's picker offers (rendering still goes
  through the full map, so any stored name keeps working).
- `lib/useStates.ts` — `['states']` query plus `formatStateDuration`, `splitStateDuration`,
  `STATE_DURATION_UNITS`, `MAX_STATE_DURATION_MINUTES`, `describeStateValue`, and
  `describeRequirements` (a whole requirement set as "Location: Home or Work, Tired: No" - walks
  `states` in their own order, so the string is stable enough to key a group by).
- `components/activities/StateValuePicker.tsx` — chips grouped by state, the codebase's only
  multi-value picker. One row per state: name in a fixed left column, chips wrapping beside it, and a
  `trailing` render slot that puts caller-supplied controls at the end of the same row.
  `singlePerState` makes a pick replace that state's other selection, which is the difference between
  the "Changes" and "Only suggest when" fields in `ActivityModal`. Those two are one bordered "States"
  panel there, hidden entirely until the user has defined a state with values.
- `components/activities/StateEffectPicker.tsx` — the whole "Changes" field: the picker above with
  `for [n] [unit]` rendered into its `trailing` slot, so the duration ends the row that made the pick
  instead of a summary list restating it. Owns `ActivityStateEffect[]` so `ActivityModal` never maps
  between ids and durations. A pick on the state's *default* value gets no duration (it would decay to
  itself), just the words that say why. Changing the unit reinterprets the number rather than
  converting it.
- `components/recommendations/RecommendationStrip.tsx` — `RecommendationPanel` (desktop column +
  mobile drawer, rendered by Plan and Calendar) and `SuggestionModeToggle`, which lives in both of its
  headers. The toggle is in the panel rather than Settings because it changes an answer already on
  screen; it moves the calendar's ghosts too, via the shared store. A row with `unlockedBy` names what
  it follows ("After work commute") above its reason line.
- `components/activities/ActivityHistoryModal.tsx` — read-only "have I been doing this", opened from a
  suggestion: the history icon on a `RecommendationPanel` row, or right-click / 400ms hold on a
  calendar ghost (`SuggestionBlock`, which owns that gesture itself - plain click still schedules).
  Reads `['events', 'activity', id]`, the same key `ActivityDetailPage` fills, so the two warm each
  other. Cadence figures are **passed in** as `RecommendationStats` (`statsOf(rec)`) rather than
  recomputed, so the dialog can't quote a different number than the row that opened it; a caller with
  no recommendation behind it (a floating occurrence) passes null and those tiles degrade. The panel
  owns its own instance of the dialog, so all three pages that render it get the feature.
- `components/states/StateSnapshotModal.tsx` — read-only "what did the world look like here", opened by
  clicking empty calendar grid (`CalendarPage.openStateSnapshot`, reached from the mouse no-drag path
  and, on touch, from `handleGridClick`). Queries `['states', 'snapshot', iso]`; silent when
  the user has no states. Creating an occurrence still needs a drag or a long press, so the plain click
  was free to take.
  ⚠️ The touch tap hangs off **`click`**, not pointerup: the Android WebView claims a pan within its own
  touch slop almost immediately and cancels the pointer, so a tap's pointerup often never arrives (the
  same takeover `onEarlyCancel` works around for event blocks) - which is why the earlier pointerup
  heuristic never fired in the app. `handleGridPointerDown` arms `tapArmedRef` with the grid position and
  every gesture that becomes something else (drag, swipe, pinch, >15px move) disarms it; `pointercancel`
  deliberately does **not**. The mouse path stays on mouseup and is kept out of the click handler by
  `lastPointerTypeRef.current !== 'touch'`, since a touch arrives there again as a compatibility event.
- `components/capture/CaptureModal.tsx` — natural-language capture: a note in, a `CaptureDraft` back,
  then handed to `EventModal` via its `draft` prop (read once by the initial state, so a fresh parse
  needs a fresh `key`). Nothing is saved here. The whole component assumes the answer is slow: the
  wait gets a running seconds counter rather than a spinner, and the call's cost goes in the modal
  **footer** (and is itself the raw-reply toggle), not in the body between the draft and the buttons.
  The editor is passed this modal's own `open`, not a literal - it calls back the same `onClose`, so
  hardcoding it left an editor nothing could dismiss. Its trigger on `PlanPreviewPage` is hidden unless
  `settings.llmEnabled`.
- `components/settings/SettingSection.tsx` — `SettingSection`/`SettingRow`/`SectionFooter`, the layout
  primitives `SettingsPage` is built from. Settings now holds preferences only.
- `pages/SettingsPage.tsx` — one `form` object and one save mutation behind several sections; the
  mutation's variable is the section that pressed Save, which is all that decides where "Changes
  saved." appears. The **Insights** section is the unaccounted-time mask (a `StateValuePicker`, no
  `singlePerState`), hidden entirely until a state has values. Saving invalidates `['insights']` too.
  The **Assistant** section is the local-model configuration plus a "Test connection" button, which
  reads the *saved* settings (`llmApi.status`) rather than the form - so every edit to the address or
  model clears the last result.
- `components/activities/ActivitiesTabs.tsx` — the underline tab strip the three activity routes share.
  A new activity-side vocabulary is a tab here, not a nav slot.
- `pages/ActivityTypesPage.tsx` — types admin: accordion per type over the full CRUD (name, icon,
  window, min block, max/day, and cadence/cooldown as worded dropdowns), page-header `+` to add,
  confirmed delete. Writes invalidate `['activityTypes']`, `['activities']` (rows embed the type's
  name and icon) and `['recommendations']`.
- `pages/StatesPage.tsx` — states admin: accordion per state, inline value list with a star for the
  default. Names and the default flag only: how long a value holds is set on the activities that cause
  it, in `StateEffectPicker`. Every value write returns the whole state, which replaces that entry in
  the `['states']` cache.
- `lib/quotes.ts` — local array of motivational quotes; Plan page picks one by day-of-year.

**Tests**
- `Unit/TestContext.cs` — in-memory SQLite + real services. Naming: `Method_scenario`.
  `Llm` is a `FakeLlmClient` whose reply each test sets, so nothing opens a socket; `EnableLlmAsync`
  gets a user past the assistant's gate.
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
  and `['recommendations']`. After any activity write invalidate `['activities']`, `['recommendations']`
  (an activity's state requirements decide whether it is suggested at all) **and `['events']`** (occurrences
  embed their activity: its title feeds `effectiveTitle` and its category feeds every row and calendar block's
  colour). After any goal write also invalidate `['goals']`.
  Suggestions are `['recommendations', date, mode]` (mode from `store/suggestionMode.ts`); every
  invalidation above uses the `['recommendations']` prefix, so it still covers both modes.
  States live under `['states']`; after a state or value write invalidate `['states']` and `['recommendations']`.
  Insights live under `['insights', period]`; a settings write invalidates `['insights']`, since the
  unaccounted-time mask moves every figure on that page.
  A snapshot is `['states', 'snapshot', iso]` with `staleTime: 0` - it depends on every occurrence around
  it, so it re-asks on open rather than being invalidated from the occurrence side.
  Activity types live under `['activityTypes']`; after a type write invalidate all three of
  `['activityTypes']`, `['activities']` (rows embed the type's name and icon) and `['recommendations']`
  (the engine resolves profiles per request).
- **Design:** see `design.md`. Use semantic color tokens, not hardcoded values.

## Gotchas

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
