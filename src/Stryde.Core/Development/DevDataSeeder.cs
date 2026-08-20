using Microsoft.EntityFrameworkCore;
using Stryde.Core.Common;
using Stryde.Core.Data;
using Stryde.Core.Entities;
using Stryde.Core.Enums;
using Stryde.Core.Services;

namespace Stryde.Core.Development;

/// <summary>What one seed run wrote, echoed back so the caller can see it landed.</summary>
public sealed record DevSeedSummary(
    string Username,
    DateOnly From,
    DateOnly To,
    int Categories,
    int ActivityTypes,
    int States,
    int Goals,
    int Checkpoints,
    int Activities,
    int Occurrences);

/// <summary>
/// Fills an account that already exists with a plausible few months of Stryde use: categories,
/// types, states, goals, activities and the occurrence history everything derived is read off.
/// <para>
/// It writes entities directly instead of going through the services. That is the point - the
/// services police one edit made by a person, and this makes a few thousand at once - but it must
/// not contradict them, so the invariants they own are kept by hand here: exactly one default value
/// per state, no duration on an effect that sets a default value, one effect per (activity, state),
/// and subtasks copied onto an occurrence the way <see cref="OccurrenceService"/> copies them.
/// </para>
/// <para>
/// The shape of the generated week matters as much as the volume. Ahead of now only *fixtures* are
/// placed - commutes, standup, the office block - because a full calendar has nothing left to
/// recommend into, and suggestions are the first thing seeded data gets looked at for. Habitual
/// start times fall out of the jitter: each routine lands within a few minutes of its own hour,
/// which is what <c>RecommendationService.ComputeStats</c> needs to see before it will quote one.
/// </para>
/// <para>Development only: registered nowhere else - see <c>Program.cs</c>.</para>
/// </summary>
public class DevDataSeeder(StrydeDbContext db, UserSettingsService settings)
{
    public const int DefaultWeeksBack = 10;
    public const int DefaultWeeksAhead = 2;
    private const int MaxWeeksBack = 104;
    private const int MaxWeeksAhead = 12;

    /// <summary>
    /// Fixed, so a reseed reproduces the dataset you were looking at rather than a fresh one: a bug
    /// you are halfway through chasing survives dropping the database.
    /// </summary>
    private readonly Random rng = new(20260820);

    /// <summary>
    /// The account to fill. With no name it is "the one user", which is what a dev database has.
    /// More than one is ambiguous rather than an invitation to guess.
    /// </summary>
    public async Task<Result<User>> ResolveUserAsync(string? username)
    {
        if (!string.IsNullOrWhiteSpace(username))
        {
            var named = await db.Users.FirstOrDefaultAsync(u => u.Username == username);
            return named is null
                ? Result<User>.Fail(new Error(ErrorType.NotFound, $"No user named '{username}'."))
                : Result<User>.Success(named);
        }

        var users = await db.Users.Take(2).ToListAsync();
        return users.Count switch
        {
            0 => Result<User>.Fail(new Error(ErrorType.NotFound, "No users yet. Register one first.")),
            1 => Result<User>.Success(users[0]),
            _ => Result<User>.Fail(new Error(ErrorType.Conflict,
                "More than one user in this database. Name one with ?username=.")),
        };
    }

    public async Task<Result<DevSeedSummary>> SeedAsync(
        Guid userId,
        bool reset,
        int weeksBack = DefaultWeeksBack,
        int weeksAhead = DefaultWeeksAhead)
    {
        if (weeksBack < 1 || weeksBack > MaxWeeksBack)
            return Invalid($"weeksBack must be between 1 and {MaxWeeksBack}.");
        if (weeksAhead < 0 || weeksAhead > MaxWeeksAhead)
            return Invalid($"weeksAhead must be between 0 and {MaxWeeksAhead}.");

        var user = await db.Users.FindAsync(userId);
        if (user is null)
            return Result<DevSeedSummary>.Fail(new Error(ErrorType.NotFound, "User not found."));

        var hasData = await db.Activities.AnyAsync(a => a.UserId == userId)
            || await db.Goals.AnyAsync(g => g.UserId == userId);
        if (hasData && !reset)
            return Result<DevSeedSummary>.Fail(new Error(ErrorType.Conflict,
                "This account already has data. Pass reset=true to replace it."));

        if (reset) await ClearAsync(userId);

        await settings.GetOrCreateAsync(userId);
        var ctx = await settings.GetDayContextAsync(userId);
        var tz = ctx.TimeZone;

        var now = DateTimeOffset.UtcNow;
        var today = DayMath.Today(ctx, now);
        var from = today.AddDays(-7 * weeksBack);
        var to = today.AddDays(7 * weeksAhead);

        // Everything is stamped in the order it is written, just before the history it explains:
        // several lists in the app are ordered by CreatedAt, and an activity with no completions has
        // its due-ness measured from its own.
        var stamp = DayMath.StartOfDay(from, ctx).AddHours(-1);
        DateTimeOffset Stamp() => stamp = stamp.AddSeconds(1);

        // ── Categories ────────────────────────────────────────────────────────────────────────
        Category Cat(string name, string color, string icon)
        {
            var c = new Category { UserId = userId, Name = name, Color = color, Icon = icon, CreatedAt = Stamp() };
            db.Categories.Add(c);
            return c;
        }

        var workCat = Cat("Work", "#3b82f6", "Briefcase");
        var healthCat = Cat("Health", "#22c55e", "Heart");
        var homeCat = Cat("Home", "#f59e0b", "Home");
        var learningCat = Cat("Learning", "#a855f7", "BookOpen");
        var socialCat = Cat("Social", "#ec4899", "Users");

        // ── Types ─────────────────────────────────────────────────────────────────────────────
        var types = await EnsureTypesAsync(userId, Stamp);

        // ── States ────────────────────────────────────────────────────────────────────────────
        // Two dimensions is enough to show both halves of the feature: Location is set by the
        // commutes and gated on by everything that can only happen somewhere, and Energy is set with
        // a duration on it, so it decays back on its own with nothing scheduled to undo it.
        State St(string name)
        {
            var s = new State { UserId = userId, Name = name, CreatedAt = Stamp() };
            db.States.Add(s);
            return s;
        }

        StateValue Val(State state, string name, bool isDefault = false)
        {
            // Added through the DbSet rather than the parent's collection: a child with a pre-set id
            // on a tracked parent reads as an existing row.
            var v = new StateValue { StateId = state.Id, Name = name, IsDefault = isDefault, CreatedAt = Stamp() };
            db.StateValues.Add(v);
            return v;
        }

        var location = St("Location");
        var atHome = Val(location, "Home", isDefault: true);
        var atWork = Val(location, "Work");
        var outside = Val(location, "Out");

        var energy = St("Energy");
        var fresh = Val(energy, "Fresh", isDefault: true);
        var tired = Val(energy, "Tired");

        // Time spent out of the house was never the user's to spend, so it is not scored as empty.
        db.UnaccountedTimeRequirements.AddRange(
            new UnaccountedTimeRequirement { UserId = userId, StateValueId = atHome.Id },
            new UnaccountedTimeRequirement { UserId = userId, StateValueId = atWork.Id });

        // ── Goals ─────────────────────────────────────────────────────────────────────────────
        var goals = new List<Goal>();
        var checkpoints = new List<Checkpoint>();

        Goal G(string title, GoalKind kind, GoalStatus status, string? description = null)
        {
            var g = new Goal
            {
                UserId = userId,
                Title = title,
                Kind = kind,
                Status = status,
                Description = description,
                CreatedAt = Stamp(),
            };
            db.Goals.Add(g);
            goals.Add(g);
            return g;
        }

        void Cp(Goal goal, string title, CheckpointSize size, CheckpointStatus status, int? targetInDays = null)
        {
            var c = new Checkpoint
            {
                GoalId = goal.Id,
                Title = title,
                Size = size,
                Status = status,
                CreatedAt = Stamp(),
                TargetDate = targetInDays is null
                    ? null
                    : DayMath.StartOfDay(today.AddDays(targetInDays.Value), ctx),
            };
            db.Checkpoints.Add(c);
            checkpoints.Add(c);
        }

        var strydeGoal = G("Ship Stryde v1", GoalKind.milestone, GoalStatus.focus,
            "The version I actually run my week on.");
        Cp(strydeGoal, "Recommendation engine", CheckpointSize.huge, CheckpointStatus.reached);
        Cp(strydeGoal, "States and requirements", CheckpointSize.big, CheckpointStatus.reached);
        Cp(strydeGoal, "Insights page", CheckpointSize.normal, CheckpointStatus.reached);
        Cp(strydeGoal, "Calendar polish", CheckpointSize.normal, CheckpointStatus.pending, 21);
        Cp(strydeGoal, "Running on the VPS", CheckpointSize.big, CheckpointStatus.pending, 45);

        var spanishGoal = G("Conversational Spanish", GoalKind.milestone, GoalStatus.focus,
            "Enough to hold a conversation without switching back to English.");
        Cp(spanishGoal, "500 words", CheckpointSize.normal, CheckpointStatus.reached);
        Cp(spanishGoal, "Present tense without thinking", CheckpointSize.small, CheckpointStatus.reached);
        Cp(spanishGoal, "Five minute chat with a tutor", CheckpointSize.big, CheckpointStatus.pending, 56);
        Cp(spanishGoal, "A film without subtitles", CheckpointSize.huge, CheckpointStatus.pending);

        var injuryGoal = G("Stay injury free", GoalKind.ongoing, GoalStatus.active,
            "Nothing to reach, just a thing to keep doing.");

        var cookingGoal = G("Learn to cook properly", GoalKind.milestone, GoalStatus.bench,
            "Parked until Stryde ships.");
        Cp(cookingGoal, "Ten meals from memory", CheckpointSize.big, CheckpointStatus.pending);
        Cp(cookingGoal, "Stop following recipes exactly", CheckpointSize.small, CheckpointStatus.pending);

        var halfGoal = G("Run a half marathon", GoalKind.milestone, GoalStatus.closed,
            "Done in the spring.");
        Cp(halfGoal, "10k without stopping", CheckpointSize.normal, CheckpointStatus.reached);
        Cp(halfGoal, "18k long run", CheckpointSize.big, CheckpointStatus.reached);
        Cp(halfGoal, "Race day", CheckpointSize.huge, CheckpointStatus.reached);

        // ── Activities ────────────────────────────────────────────────────────────────────────
        var activities = new List<Activity>();
        var stepsByActivity = new Dictionary<Guid, List<string>>();

        Activity A(string title, Category? category, string? typeName, Goal? goal = null, bool muted = false)
        {
            var a = new Activity
            {
                UserId = userId,
                Title = title,
                CategoryId = category?.Id,
                GoalId = goal?.Id,
                ActivityTypeId = typeName is null ? null : types[typeName].Id,
                ExcludeFromRecommendations = muted,
                CreatedAt = Stamp(),
            };
            db.Activities.Add(a);
            activities.Add(a);
            return a;
        }

        void Sets(Activity a, StateValue value, int? holdsForMinutes = null) =>
            db.ActivityStateEffects.Add(new ActivityStateEffect
            {
                ActivityId = a.Id,
                StateId = value.StateId,
                StateValueId = value.Id,
                DurationMinutes = holdsForMinutes,
            });

        void Needs(Activity a, params StateValue[] values) =>
            db.ActivityStateRequirements.AddRange(values.Select(v =>
                new ActivityStateRequirement { ActivityId = a.Id, StateValueId = v.Id }));

        void Steps(Activity a, params string[] titles)
        {
            stepsByActivity[a.Id] = [.. titles];
            db.ActivitySubtasks.AddRange(titles.Select(t =>
                new ActivitySubtask { ActivityId = a.Id, Title = t, CreatedAt = Stamp() }));
        }

        // The commutes are the pair that makes chained suggestions mean anything: each requires the
        // location the other one leaves you in.
        var commuteIn = A("Commute to work", workCat, "Routine");
        Sets(commuteIn, atWork);
        Needs(commuteIn, atHome);

        var commuteOut = A("Commute home", workCat, "Routine");
        Sets(commuteOut, atHome);
        Needs(commuteOut, atWork);

        var standup = A("Team standup", workCat, null, muted: true);
        Needs(standup, atWork);

        var officeBlock = A("Focus block at the office", workCat, "Deep work");
        Needs(officeBlock, atWork);

        var inbox = A("Inbox and admin", workCat, "Routine");
        Needs(inbox, atWork);

        var run = A("Morning run", healthCat, "Training", injuryGoal);
        Sets(run, tired, 600);
        Needs(run, atHome, fresh);

        var gym = A("Gym session", healthCat, "Training");
        Sets(gym, tired, 480);
        Needs(gym, atHome, fresh);

        var stretch = A("Evening stretch", healthCat, "Routine", injuryGoal);
        Needs(stretch, atHome);

        var physio = A("Physio exercises", healthCat, "Routine", injuryGoal);
        Needs(physio, atHome);
        Steps(physio, "Band work", "Single leg balance", "Calf raises");

        var groceries = A("Grocery run", homeCat, "Chore");
        Sets(groceries, outside, 90);
        Needs(groceries, atHome);

        var laundry = A("Laundry", homeCat, "Chore");
        Needs(laundry, atHome);
        Steps(laundry, "Sort", "Wash", "Hang to dry");

        var kitchen = A("Tidy the kitchen", homeCat, "Routine");
        Needs(kitchen, atHome);

        // Nights are logged because the app measures the day it is given: with nothing between 23:00
        // and 07:00 every night reads as eight hours of unaccounted time on the insights page, and
        // the engine cheerfully suggests into them. Placed ahead of now for that second reason, and
        // it is what puts Energy back to its default in the morning - a change to a default value,
        // so it carries no duration.
        var sleep = A("Sleep", homeCat, null, muted: true);
        Sets(sleep, fresh);

        var deepWork = A("Deep work on Stryde", learningCat, "Deep work", strydeGoal);
        Needs(deepWork, atHome, fresh);
        Steps(deepWork, "Pick one thing", "Write the test first", "Update the docs");

        var spanish = A("Spanish practice", learningCat, "Routine", spanishGoal);

        var read = A("Read", learningCat, "General");
        Needs(read, atHome);

        var callParents = A("Call parents", socialCat, "General");
        var boardGames = A("Board game night", socialCat, null);
        var coffee = A("Coffee with a friend", socialCat, "General");

        // ── The imaginary week ────────────────────────────────────────────────────────────────
        DayOfWeek[] weekdays =
        [
            DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday,
        ];
        DayOfWeek[] everyDay = Enum.GetValues<DayOfWeek>();

        List<Routine> week =
        [
            new(commuteIn, weekdays, new(7, 40), 35, 0.95, Fixture: true),
            new(standup, weekdays, new(9, 15), 15, 0.9, Fixture: true, JitterMinutes: 5),
            new(officeBlock, weekdays, new(10, 0), 120, 0.7, Fixture: true),
            new(inbox, weekdays, new(16, 0), 45, 0.65),
            new(commuteOut, weekdays, new(17, 30), 35, 0.95, Fixture: true, JitterMinutes: 15),

            new(run, [DayOfWeek.Tuesday, DayOfWeek.Thursday, DayOfWeek.Saturday], new(6, 30), 45, 0.65),
            new(gym, [DayOfWeek.Monday, DayOfWeek.Wednesday], new(18, 45), 70, 0.6),
            new(physio, [DayOfWeek.Monday, DayOfWeek.Wednesday, DayOfWeek.Friday], new(7, 0), 20, 0.5),
            new(stretch, everyDay, new(21, 45), 15, 0.45),

            new(sleep, everyDay, new(23, 15), 450, 0.97, Fixture: true, JitterMinutes: 20, SkipChance: 0),

            new(groceries, [DayOfWeek.Saturday], new(10, 30), 50, 0.8),
            new(groceries, [DayOfWeek.Tuesday], new(19, 15), 45, 0.25),
            new(laundry, [DayOfWeek.Sunday], new(11, 0), 60, 0.85),
            new(kitchen, everyDay, new(20, 15), 20, 0.55),

            new(deepWork, [DayOfWeek.Saturday, DayOfWeek.Sunday], new(9, 30), 120, 0.55),
            new(deepWork, [DayOfWeek.Tuesday, DayOfWeek.Thursday], new(19, 45), 90, 0.45),
            new(spanish, weekdays, new(20, 45), 25, 0.5),
            new(read, everyDay, new(22, 15), 30, 0.5),

            new(callParents, [DayOfWeek.Sunday], new(18, 0), 30, 0.8, JitterMinutes: 20),
            new(boardGames, [DayOfWeek.Friday], new(19, 30), 180, 0.35, Fixture: true, Planned: true),
            new(coffee, [DayOfWeek.Saturday], new(15, 0), 60, 0.3),
        ];

        var occurrences = new List<Occurrence>();

        Occurrence Occ(
            Activity activity,
            DateTimeOffset? start,
            DateTimeOffset? end,
            EventStatus status,
            string? title = null,
            bool planned = false,
            bool allDay = false,
            int? durationMinutes = null)
        {
            var o = new Occurrence
            {
                UserId = userId,
                ActivityId = activity.Id,
                Title = title,
                StartAt = start,
                EndAt = end,
                Status = status,
                IsPlanned = planned,
                IsAllDay = allDay,
                DurationMinutes = durationMinutes,
                CreatedAt = start ?? Stamp(),
            };
            db.Occurrences.Add(o);
            occurrences.Add(o);

            if (stepsByActivity.TryGetValue(activity.Id, out var titles))
            {
                var i = 0;
                db.OccurrenceSubtasks.AddRange(titles.Select(t => new OccurrenceSubtask
                {
                    OccurrenceId = o.Id,
                    Title = t,
                    IsDone = status == EventStatus.done,
                    CreatedAt = o.CreatedAt.AddSeconds(i++),
                }));
            }

            return o;
        }

        for (var day = from; day <= to; day = day.AddDays(1))
        {
            foreach (var r in week)
            {
                if (!r.Days.Contains(day.DayOfWeek)) continue;
                if (rng.NextDouble() > r.Chance) continue;

                var start = LocalInstant(day, r.Start, tz).AddMinutes(Jitter(r.JitterMinutes));
                var length = Math.Max(5, r.DurationMinutes + Jitter(r.DurationMinutes / 5));
                var end = start.AddMinutes(length);

                // Ahead of now, only the fixtures. A calendar that is already full has nothing left
                // to recommend into, which is the first thing seeded data gets looked at for.
                if (end > now && !r.Fixture) continue;

                var status = end <= now
                    ? rng.NextDouble() < r.SkipChance ? EventStatus.skipped : EventStatus.done
                    : EventStatus.pending;

                Occ(r.Activity, start, end, status, planned: r.Planned);
            }
        }

        // ── The shapes a week does not produce on its own ──────────────────────────────────────
        // One of each scheduling state, so no list or row style anywhere is empty: floating, planned
        // floating, a planned window, all-day, a due pin, and something genuinely overdue.
        Occ(coffee, null, null, EventStatus.pending);
        Occ(read, null, null, EventStatus.pending, title: "Finish the book on habits");
        Occ(deepWork, null, null, EventStatus.pending, planned: true, durationMinutes: 90);

        var yesterday = today.AddDays(-1);
        Occ(groceries, LocalInstant(yesterday, new(18, 0), tz), LocalInstant(yesterday, new(18, 50), tz),
            EventStatus.pending);

        var saturday = NextWeekday(today.AddDays(1), DayOfWeek.Saturday);
        Occ(deepWork, LocalInstant(saturday, new(9, 0), tz), LocalInstant(saturday, new(13, 0), tz),
            EventStatus.pending, planned: true, durationMinutes: 120);

        // ── Events ────────────────────────────────────────────────────────────────────────────
        Occurrence Event(
            string title,
            Category? category,
            DateTimeOffset? start,
            DateTimeOffset? end,
            EventStatus status,
            bool allDay = false)
        {
            // An event's activity is a backing row owned by exactly one occurrence.
            var backing = new Activity
            {
                UserId = userId,
                Title = title,
                Kind = ActivityKind.@event,
                CategoryId = category?.Id,
                CreatedAt = Stamp(),
            };
            db.Activities.Add(backing);
            activities.Add(backing);
            return Occ(backing, start, end, status, allDay: allDay);
        }

        Event("Dentist", healthCat, LocalInstant(today.AddDays(-12), new(9, 0), tz),
            LocalInstant(today.AddDays(-12), new(9, 45), tz), EventStatus.done);
        Event("Anna's birthday", socialCat, LocalInstant(today.AddDays(4), TimeOnly.MinValue, tz),
            null, EventStatus.pending, allDay: true);
        Event("Flight to Berlin", socialCat, LocalInstant(today.AddDays(6), new(6, 30), tz),
            LocalInstant(today.AddDays(6), new(9, 30), tz), EventStatus.pending);
        Event("Renew the passport", homeCat, null, LocalInstant(today.AddDays(9), new(17, 0), tz),
            EventStatus.pending);

        await db.SaveChangesAsync();

        return Result<DevSeedSummary>.Success(new DevSeedSummary(
            user.Username, from, to,
            Categories: 5,
            ActivityTypes: types.Count,
            States: 2,
            Goals: goals.Count,
            Checkpoints: checkpoints.Count,
            Activities: activities.Count,
            Occurrences: occurrences.Count));
    }

    /// <summary>
    /// Everything the seeder owns, which is everything the account holds except the user, their
    /// settings row and their refresh tokens - the login has to survive a reseed.
    /// <para>
    /// Deleted in three passes rather than one because the link rows are keyed by their contents and
    /// cascade from both ends: taking them out first means the order EF picks for the rest cannot
    /// matter.
    /// </para>
    /// </summary>
    private async Task ClearAsync(Guid userId)
    {
        db.ActivityStateEffects.RemoveRange(
            await db.ActivityStateEffects.Where(e => e.Activity.UserId == userId).ToListAsync());
        db.ActivityStateRequirements.RemoveRange(
            await db.ActivityStateRequirements.Where(r => r.Activity.UserId == userId).ToListAsync());
        db.UnaccountedTimeRequirements.RemoveRange(
            await db.UnaccountedTimeRequirements.Where(r => r.UserId == userId).ToListAsync());
        db.OccurrenceSubtasks.RemoveRange(
            await db.OccurrenceSubtasks.Where(s => s.Occurrence.UserId == userId).ToListAsync());
        db.ActivitySubtasks.RemoveRange(
            await db.ActivitySubtasks.Where(s => s.Activity.UserId == userId).ToListAsync());
        await db.SaveChangesAsync();

        db.Occurrences.RemoveRange(await db.Occurrences.Where(o => o.UserId == userId).ToListAsync());
        db.Activities.RemoveRange(await db.Activities.Where(a => a.UserId == userId).ToListAsync());
        db.Checkpoints.RemoveRange(await db.Checkpoints.Where(c => c.Goal.UserId == userId).ToListAsync());
        db.Goals.RemoveRange(await db.Goals.Where(g => g.UserId == userId).ToListAsync());
        await db.SaveChangesAsync();

        db.StateValues.RemoveRange(await db.StateValues.Where(v => v.State.UserId == userId).ToListAsync());
        db.States.RemoveRange(await db.States.Where(s => s.UserId == userId).ToListAsync());
        db.Categories.RemoveRange(await db.Categories.Where(c => c.UserId == userId).ToListAsync());
        db.ActivityTypes.RemoveRange(await db.ActivityTypes.Where(t => t.UserId == userId).ToListAsync());
        await db.SaveChangesAsync();
    }

    /// <summary>
    /// The user's types by name: whatever is already there, plus the two presets the seeded week
    /// needs. Existing rows are reused rather than duplicated, and every number here is one the
    /// editor's dropdowns can round-trip - a seeded type the UI cannot reproduce by hand would be a
    /// built-in, which is the thing user-owned types exist to avoid.
    /// </summary>
    private async Task<Dictionary<string, ActivityType>> EnsureTypesAsync(
        Guid userId, Func<DateTimeOffset> stamp)
    {
        var existing = await db.ActivityTypes.Where(t => t.UserId == userId).ToListAsync();
        var byName = existing.ToDictionary(t => t.Name, StringComparer.OrdinalIgnoreCase);

        var wanted = ActivityTypeService.DefaultsFor(userId).Concat(new[]
        {
            // Daily, one a day, across the whole civil day: the things that hold a week together.
            new ActivityType
            {
                UserId = userId, Name = "Routine", Icon = "Sparkles",
                WindowStart = new(6, 0), WindowEnd = new(22, 0),
                MinBlockMinutes = 0, MaxPerDay = 1,
                CadencePriorDays = 1, MinDueFraction = 0.5,
            },
            new ActivityType
            {
                UserId = userId, Name = "Chore", Icon = "ShoppingCart",
                WindowStart = new(9, 0), WindowEnd = new(20, 0),
                MinBlockMinutes = 30, MaxPerDay = 2,
                CadencePriorDays = 7, MinDueFraction = 0.5,
            },
        });

        foreach (var type in wanted)
        {
            if (byName.ContainsKey(type.Name)) continue;
            type.CreatedAt = stamp();
            db.ActivityTypes.Add(type);
            byName[type.Name] = type;
        }

        return byName;
    }

    /// <summary>
    /// One line of the imaginary week. <paramref name="Chance"/> is how often it actually happened,
    /// which is what gives the activity a cadence to be measured against, and
    /// <paramref name="Fixture"/> marks the ones that are also placed ahead of now.
    /// </summary>
    private sealed record Routine(
        Activity Activity,
        DayOfWeek[] Days,
        TimeOnly Start,
        int DurationMinutes,
        double Chance,
        bool Fixture = false,
        bool Planned = false,
        int JitterMinutes = 10,
        double SkipChance = 0.08);

    /// <summary>
    /// Minutes off the nominal time, in fives. Kept small on purpose: a habitual start time is the
    /// fullest 40 minute cluster of observed starts, so a routine that wandered by an hour would
    /// have no habit to find and every screen that quotes one would go quiet.
    /// </summary>
    private int Jitter(int minutes)
    {
        var steps = minutes / 5;
        return steps <= 0 ? 0 : 5 * rng.Next(-steps, steps + 1);
    }

    /// <summary>A local wall-clock time on a local date, as the instant the app stores.</summary>
    private static DateTimeOffset LocalInstant(DateOnly day, TimeOnly time, TimeZoneInfo tz)
    {
        var local = day.ToDateTime(time);
        return new DateTimeOffset(local, tz.GetUtcOffset(local));
    }

    private static DateOnly NextWeekday(DateOnly from, DayOfWeek day)
    {
        while (from.DayOfWeek != day) from = from.AddDays(1);
        return from;
    }

    private static Result<DevSeedSummary> Invalid(string message) =>
        Result<DevSeedSummary>.Fail(new Error(ErrorType.Validation, message));
}
