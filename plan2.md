# Phase 2: activity types become user-created rows

Working plan, not build history. Fold the outcome into `plan.md` when it ships and delete this file.

## Context

Phase 1 (States) shipped: `work` and `commute` are gone, `AnchorType`/`Adjacency` are gone, and
`ActivityType` is back to `general | training | deepWork` holding nothing but scheduling numbers.

The objection that drove Phase 1 applies once more, one level up. If a type is a behavioural preset,
the preset list should be the user's, not the codebase's. Hardcoding three is less wrong than
hardcoding five, but it is the same kind of wrong: two of the three types added over the project's life
(`training`, `eveningHabit`) were added because an existing type's *values* did not fit a real
activity, which is the argument for authoring types rather than adding enum values.

The change is also a **net deletion**. The entire sparse-override system exists only because the type
list is fixed - it reconciles "your values" against "my values". If the type *is* a row you own, there
is nothing to reconcile.

Outcome: `ActivityType` stops being an enum and becomes a user-owned entity. `ActivityTypeSetting` and
the whole resolve-and-layer machinery are deleted. Cadence and cooldown become editable, in words.

## Decisions already settled

Agreed in discussion before Phase 1 was built. Do not relitigate these:

- **Null replaces `general`.** "No type" *is* the unconstrained default. `Activity.Type` becomes a
  nullable `ActivityTypeId` FK with `DeleteBehavior.SetNull`, matching Category and Goal.
- **Cadence prior and cooldown become editable**, in human wording rather than raw numbers. Leaving
  them hidden would make a user-made type permanently weaker than the built-in `training`, whose 2.5d
  cadence and 0.5 cooldown are the only reason it behaves differently from `general`. That asymmetry is
  the very thing this change is about.
- **Icons reuse the category precedent exactly** - stored as a lucide component-name string, rendered
  through an `ICON_MAP` lookup that degrades to a fallback on an unknown key.
- **One type per activity still.** Multi-type stays rejected: it would need a combination rule for
  every scalar on the profile plus a notion of "several" in the tile, the grouping and the editor.
- **No type-level default state predicate.** It is sugar, adds no power, and re-couples types to
  States. Requirements stay on the activity.

## Model

New entity `src/Stryde.Core/Entities/ActivityType.cs`. Name clashes with the enum being deleted, so
delete the enum in the same commit. Carries a `public User User` navigation, which gets a cascading FK
plus a `UserId` index by convention (the `State` entity added in Phase 1 is the precedent).

```
Id, UserId, Name, Icon (string?), WindowStart (TimeOnly), WindowEnd (TimeOnly),
MinBlockMinutes (int), MaxPerDay (int), CadencePriorDays (double), MinDueFraction (double), CreatedAt
User (nav)
```

`Activity.Type` (`ActivityType`, non-null, defaults to `general`) becomes `ActivityTypeId` (`Guid?`)
plus an `ActivityType? Type` navigation.

`TimeOnly` columns need the `timeOnlyToString` converter already declared in
`StrydeDbContext.OnModelCreating` for `ActivityTypeSetting` - keep that converter when the entity it
was written for goes away, and switch it from the nullable to the non-null form.

### The unconstrained default, when there is no type

`ActivityProfiles.cs` currently supplies the `general` row. With types as rows, an activity with no
type needs the same numbers from somewhere. Keep a single `ActivityProfile.Unconstrained` static on
`ActivityProfiles` (window 08:00-21:00, no block floor, `DefaultCadenceDays`, no cap, no cooldown) and
delete `Map`, `AllTypes` and `For`. `DefaultCadenceDays` and `MaxColdStartScore` both stay - they are
engine constants, not type values.

## Deletions

This is most of the diff. Verify each is gone before calling the phase done.

| Location | Delete |
|---|---|
| `Enums/Enums.cs` | `enum ActivityType` |
| `Entities/ActivityTypeSetting.cs` | whole file |
| `Data/StrydeDbContext.cs` | `ActivityTypeSettings` DbSet + its key/conversion/converter block |
| `Common/ActivityProfiles.cs` | `Map`, `AllTypes`, `For`; keep the two constants, add `Unconstrained` |
| `Services/ActivityProfileService.cs` | `LoadOverridesAsync`, `Apply`, `IsCustomised`, the store-only-what-differs branch in `UpdateAsync`, `ResetAsync`. `ResolveAsync` becomes a plain query |
| `Dtos/Dtos.cs` | `ActivityProfileDto.IsCustomised` (nothing to be customised *from*) |
| `Endpoints/SettingsEndpoints.cs` | the three `/activity-types` routes and their `Enum.TryParse` key parsing |
| `client/src/lib/activityTypes.ts` | `ACTIVITY_TYPES`, `activityTypeMeta`, `ActivityTypeMeta`, the per-enum blurbs. Keep `describeProfile`/`profileHint`/`formatWindowTime`, retargeted at the row |
| `client/src/lib/useActivityProfiles.ts` | whole file, replaced by `useActivityTypes` returning rows |

`ActivityProfileService` may end up thin enough to fold into a new `ActivityTypeService` (CRUD +
`ResolveAsync`). Decide when the deletions are in and the remainder is visible; don't pre-commit.

## Backend work

**`Services/ActivityTypeService.cs`** - CRUD modelled on `StateService.cs` from Phase 1, which is the
closest precedent for a user-owned lookup with validation. Reuse `Validators.ValidateTitle(name,
"Name")`. Client-side `OrderBy(CreatedAt)` after `ToListAsync` (SQLite cannot order a
`DateTimeOffset`). Carry over the existing validation from `ActivityProfileService.UpdateAsync`
verbatim - window start before end, `MinBlockMinutes` 0-480, `MaxPerDay` 0-24 - and add bounds for the
two newly-editable fields. Deleting a type is allowed and set-nulls its activities, like a category.

**Seeding.** `AuthService.RegisterAsync` currently creates only the `User` row - it does not even
create `UserSettings` (`UserSettingsService` falls back when the row is absent). Types cannot fall back
that way, since the whole point is that the rows *are* the list. So `RegisterAsync` grows a seed step
creating General / Training / Deep work from the old defaults table. Note this is the first thing
registration seeds; put it behind a `ActivityTypeService.SeedDefaultsAsync(userId)` so the migration
below can share it.

**Engine** (`RecommendationService`). Mechanical: `profileByType` becomes keyed by `Guid?` instead of
the enum, and every lookup needs the null case to yield `ActivityProfiles.Unconstrained`. A small
`Profile(Guid? typeId)` local function is cleaner than sprinkling `?? Unconstrained`. Affects
`FitsASlot`, `PlaceActivity`, `DueFraction`, `PastCooldown`, `TakeTypeSlot`, `typeCounts` and
`todayTypeByActivity` (which still exists only to seed the per-day cap, and now selects `TypeId`).

**Endpoints.** New `Endpoints/ActivityTypeEndpoints.cs` with `/api/activity-types` (GET / POST / PUT
/{id} / DELETE /{id}), registered in `Program.cs` and DI in `ServiceCollectionExtensions.cs`. This is a
**breaking move** off `/api/settings/activity-types`: single-user app, no external clients, so just
move it rather than keeping a shim.

**Export.** `ExportDto.ActivityProfiles` becomes the type rows. `ExportService` is the second consumer
of any profile-shaped change - check it every time.

## Wording for the two new knobs

Not raw doubles. Both map onto the existing fields; a select whose options carry the numbers.

| Cadence prior | Value |
|---|---|
| Daily | 1 |
| Every few days | 2.5 |
| Weekly | 7 |
| Every couple of weeks | 14 |

Labelled something like "Before I've learned from your history, assume this happens...".

| Cooldown | `MinDueFraction` |
|---|---|
| As soon as it's due | 0 |
| Once you're halfway to due | 0.5 |
| Only when fully due | 1.0 |

Labelled "After doing this, it can be suggested again...". The built-in three must be expressible as
ordinary rows with nothing privileged: `training` is Every few days (2.5) + halfway (0.5), `deepWork`
is Every few days (3.0)... which the table above cannot say. Either widen the cadence options to
include 3, or accept `deepWork` seeding at 2.5. **Decide before writing the seed** - a seeded value the
UI cannot round-trip is exactly the asymmetry this phase removes.

## Migration

Two migrations, following the Phase 1 pair.

1. `dotnet ef migrations add AddActivityTypes` - creates `ActivityTypes`, adds
   `Activities.ActivityTypeId`, drops `ActivityTypeSettings`, drops `Activities.Type`.
2. A hand-written data migration between them in effect, so **write it as one migration ordered before
   the column drop**, or split the tool-generated one. Per user, per distinct existing `Type` string:
   insert an `ActivityTypes` row carrying the resolved values (defaults with that user's
   `ActivityTypeSetting` overrides applied, since the overrides are about to be deleted), then point
   the user's activities at it by matching the old TEXT value. Activities on `general` get
   `ActivityTypeId = NULL`, since null is now the unconstrained default.

   This is more than raw SQL comfortably expresses - it needs the defaults table and the override
   layering. Two options, pick when writing it:
   - Raw SQL with the default values inlined as literals in the migration (they are frozen history at
     that point, which is arguably correct for a migration).
   - A one-shot service method invoked from `MigrateDatabase` behind an "already seeded" check.

   Prefer the first. A migration that calls into live application code breaks the moment that code
   changes, which is precisely how this file's subject matter has behaved twice now.

   Hand-written convention: round-zeroed timestamp, raw SQL in `Up`, empty `Down`, `.Designer.cs`
   hand-copied from the preceding migration with only the `[Migration]` and `partial class` lines
   changed (`Compare-Object` should show exactly two differing lines), model snapshot untouched.

## Frontend

`ActivityType` had 9 consumer files before Phase 1 and `CalendarPage` is not among them (its `anchorY`
matches are pointer-drag geometry). Phase 1 did not add consumers, so the fan-out is unchanged: wide
but shallow.

- **`lib/types.ts`** - `ActivityType` stops being a string union and becomes the row interface
  (`id, userId, name, icon, windowStart, windowEnd, minBlockMinutes, maxPerDay, cadencePriorDays,
  minDueFraction, createdAt`). `Activity.type` becomes `activityTypeId: string | null` plus an embedded
  summary. `ActivityProfile` merges into it - there is no longer a resolved-versus-declared distinction.
- **`lib/api.ts`** - `activityTypesApi` CRUD replacing `activityProfilesApi`, copying `categoriesApi`.
- **`lib/useActivityTypes.ts`** - `['activityTypes']` query, replacing `useActivityProfiles`.
- **`components/settings/ActivityTypeSettings.tsx`** - substantial rewrite rather than an edit. Gains
  add/rename/delete and an icon picker; loses the Custom pill, the Reset button, and iterating a
  hardcoded array. The accordion shell, the `useEffect` resync on `[profile, open]`, and the hand-rolled
  footer are all worth keeping. Follow `StateSettings.tsx` from Phase 1 for the add-row-at-the-bottom
  and confirm-delete shape.
- **`components/activities/ActivityModal.tsx`** - the type chip row iterates rows and gains a "None"
  chip. `profileHint` reads the row directly.
- **`components/activities/ActivityListRow.tsx`** - the `activity.type !== 'general'` hide rule becomes
  a null check; the tile icon comes from the row's stored icon name.
- **`pages/ActivitiesPage.tsx`** - type grouping seeds buckets from the fetched rows instead of
  `ACTIVITY_TYPES`, and gains a real "No type" bucket. Today `noneLabel` is `''` for type grouping and
  the `if (noneLabel)` guard skips seeding the catch-all, which is what needs to change. Search matches
  the row name.
- **`components/activities/BulkAssignModal.tsx`** - type options come from the rows, and type gains the
  `CLEAR` sentinel the goal and category fields already have (it had none, because type was non-null).
- **Query keys** - `['activityTypes']` replaces `['activityProfiles']`; still invalidate
  `['recommendations']` after a write, since the engine resolves per request.

## Tests

- `Unit/ActivityProfileServiceTests.cs` and `Integration/ActivityProfileTests.cs` both exist and both
  test the sparse-override behaviour being deleted. Replace rather than adapt: new
  `Unit/ActivityTypeServiceTests.cs` (validation bounds, delete set-nulls its activities, seeding
  produces the three) and `Integration/ActivityTypeTests.cs` (CRUD round trip, auth required, another
  user's type is 404).
- `Unit/RecommendationServiceTests.cs` - `AddActivityAsync(..., ActivityType type = ...)` is used
  throughout, so its signature change touches many tests. Take `Guid? typeId = null` and add a helper
  that creates a type row. Add a test that an activity with **no** type gets the unconstrained profile.
- `Integration/ExportTests.cs` asserts on the export shape - check it.
- `Unit/TestContext.cs` - swap `ActivityProfileService` for `ActivityTypeService`.
- **Migration test worth adding** and currently absent for anything: the data migration is the one
  irreversible step here, and tests use `EnsureCreated()` rather than `Migrate()` so nothing exercises
  it. Consider a single test that runs `Migrate()` against a temp file DB seeded with pre-migration
  rows. If that fights the factory, at minimum verify by hand against a copy of the real DB.

## Docs

Per the doc sync rule: `spec.md` Activity Types section (the table becomes "what a new type starts
from" rather than the canonical list, plus the two new editable fields and the null-means-unconstrained
rule), `CLAUDE.md` file map and the `ActivityProfiles.cs` / `ActivityTypeSetting` entries, and a
`plan.md` entry. `design.md` is stale by standing instruction - skip it.

## Verification

```
dotnet build
dotnet test
cd client && npm run build     # tsc -b catches every stale ActivityType usage, and there will be many
```

The user runs the API; do not `dotnet run`. End to end:

1. Settings → Activity types: the three seeded rows are there, each editable including cadence and
   cooldown, each deletable.
2. Create a type "Errands" with an icon, a 10:00-18:00 window and a weekly cadence. It appears in the
   activity modal chip row and in the Activities page type grouping.
3. Set an activity to no type: the row tile shows the neutral default, and the activity lands in the
   "No type" bucket.
4. Delete "Errands" while an activity uses it: the activity survives with no type.
5. Suggestions still respect a customised window and cap, and a state requirement still masks placement
   (Phase 1 must not regress).
6. **Check the real DB after migrating** - every activity previously on `training` or `deepWork` points
   at the right new row, everything on `general` is null, and any `ActivityTypeSetting` override the
   user had is reflected in the row's values rather than lost.

## Risk

The migration is the only step that can lose data, and it is doing real work rather than a rename:
per-user row creation plus override layering plus an FK backfill, against a column that is about to be
dropped. Back up `stryde.db` before the first `Migrate()`. Everything else is compile-time enforced -
`tsc -b` and the C# compiler will find every stale reference, which is why the wide fan-out is cheap.
