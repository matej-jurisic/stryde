using Stryde.Core.Dtos;
using Stryde.Core.Entities;
using Stryde.Core.Enums;

namespace Stryde.Tests.Unit;

public class RecommendationServiceTests : IDisposable
{
    private readonly TestContext _ctx = new();

    public void Dispose() => _ctx.Dispose();

    private async Task<Guid> CreateUserAsync(string timezone = "UTC", TimeOnly? dayBoundary = null)
    {
        var user = new User
        {
            Username = "u" + Guid.NewGuid().ToString("N")[..8],
            PasswordHash = "x",
            Timezone = timezone,
        };
        _ctx.Db.Users.Add(user);
        if (dayBoundary.HasValue)
            _ctx.Db.UserSettings.Add(new UserSettings { UserId = user.Id, DayBoundaryTime = dayBoundary.Value });
        await _ctx.Db.SaveChangesAsync();
        return user.Id;
    }

    private async Task<Activity> AddActivityAsync(
        Guid userId, string title, GoalStatus? goalStatus = null,
        Guid? typeId = null, DateTimeOffset? createdAt = null)
    {
        Goal? goal = null;
        if (goalStatus.HasValue)
        {
            goal = new Goal { UserId = userId, Title = title + " goal", Status = goalStatus.Value };
            _ctx.Db.Goals.Add(goal);
            await _ctx.Db.SaveChangesAsync();
        }
        var activity = new Activity { UserId = userId, Title = title, GoalId = goal?.Id, ActivityTypeId = typeId };
        // Cold-start scoring measures from creation, and the default is the real wall clock, which
        // is in the future relative to the fixed test clock.
        if (createdAt.HasValue) activity.CreatedAt = createdAt.Value;
        _ctx.Db.Activities.Add(activity);
        await _ctx.Db.SaveChangesAsync();
        return activity;
    }

    // Cached per (user, name): activities sharing a type must share the row, or a per-day cap would
    // apply to each of them separately and every cap test would pass for the wrong reason.
    private readonly Dictionary<(Guid UserId, string Name), Guid> _typeIds = [];

    private async Task<Guid> TypeAsync(
        Guid userId, string name, TimeOnly windowStart, TimeOnly windowEnd,
        int minBlockMinutes = 0, int maxPerDay = 0,
        double cadencePriorDays = 7.0, double minDueFraction = 0)
    {
        if (_typeIds.TryGetValue((userId, name), out var existing)) return existing;

        var type = new ActivityType
        {
            UserId = userId,
            Name = name,
            WindowStart = windowStart,
            WindowEnd = windowEnd,
            MinBlockMinutes = minBlockMinutes,
            MaxPerDay = maxPerDay,
            CadencePriorDays = cadencePriorDays,
            MinDueFraction = minDueFraction,
        };
        _ctx.Db.ActivityTypes.Add(type);
        await _ctx.Db.SaveChangesAsync();
        _typeIds[(userId, name)] = type.Id;
        return type.Id;
    }

    // The two seeded defaults these tests lean on, matching ActivityTypeService.DefaultsFor.
    private Task<Guid> TrainingAsync(Guid userId) =>
        TypeAsync(userId, "Training", new(15, 0), new(21, 0), 45, 2, 2.5, 0.5);

    private Task<Guid> DeepWorkAsync(Guid userId) =>
        TypeAsync(userId, "Deep work", new(9, 0), new(17, 0), 90, 2, 2.5);

    private async Task<Occurrence> AddOccurrenceAsync(
        Guid userId, Activity activity,
        DateTimeOffset? startAt = null, DateTimeOffset? endAt = null,
        EventStatus status = EventStatus.pending,
        bool isAllDay = false, bool isPlanned = false)
    {
        var o = new Occurrence
        {
            UserId = userId,
            ActivityId = activity.Id,
            StartAt = startAt,
            EndAt = endAt,
            Status = status,
            IsAllDay = isAllDay,
            IsPlanned = isPlanned,
        };
        _ctx.Db.Occurrences.Add(o);
        await _ctx.Db.SaveChangesAsync();
        return o;
    }

    private Task<Occurrence> CompleteAsync(Guid userId, Activity activity, DateTimeOffset startAt, DateTimeOffset? endAt = null) =>
        AddOccurrenceAsync(userId, activity, startAt, endAt, EventStatus.done);

    private static readonly DateTimeOffset Now = new(2026, 7, 7, 12, 0, 0, TimeSpan.Zero); // Tuesday
    private static readonly DateOnly Today = new(2026, 7, 7);

    private static DateTimeOffset At(int day, int hour, int minute = 0) =>
        new(2026, 7, day, hour, minute, 0, TimeSpan.Zero);

    [Fact]
    public async Task GetAsync_goal_tiers_surface_activities_by_goal_status()
    {
        var userId = await CreateUserAsync();
        var focus = await AddActivityAsync(userId, "focus task", GoalStatus.focus);
        var active = await AddActivityAsync(userId, "active task", GoalStatus.active);

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Equal(2, recs.Count);
        Assert.Equal(1, recs[0].Tier);
        Assert.Equal(focus.Id, recs[0].Activity.Id);
        Assert.Equal(2, recs[1].Tier);
        Assert.Equal(active.Id, recs[1].Activity.Id);
    }

    [Fact]
    public async Task GetAsync_activity_scheduled_today_is_excluded()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "scheduled", GoalStatus.focus);
        await AddOccurrenceAsync(userId, activity, startAt: At(7, 9));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Empty(recs);
    }

    [Fact]
    public async Task GetAsync_activity_completed_today_is_excluded()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "already done", GoalStatus.focus);
        await CompleteAsync(userId, activity, At(7, 9), At(7, 10));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        // Doing it has to count for at least as much as merely planning it
        Assert.Empty(recs);
    }

    [Fact]
    public async Task GetAsync_activity_scheduled_on_another_day_is_still_suggested()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "overdue elsewhere", GoalStatus.active);
        await AddOccurrenceAsync(userId, activity, startAt: At(5, 9));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Single(recs);
        Assert.Equal(activity.Id, recs[0].Activity.Id);
    }

    [Fact]
    public async Task GetAsync_tier3_surfaces_activities_with_weekday_pattern()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "Tuesday deep work");

        // 2 completions on Tuesdays: Jun 23 and Jun 30
        await CompleteAsync(userId, activity, new DateTimeOffset(2026, 6, 23, 9, 0, 0, TimeSpan.Zero));
        await CompleteAsync(userId, activity, new DateTimeOffset(2026, 6, 30, 9, 0, 0, TimeSpan.Zero));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Single(recs);
        Assert.Equal(3, recs[0].Tier);
        Assert.Equal(activity.Id, recs[0].Activity.Id);
    }

    [Fact]
    public async Task GetAsync_tier3_suppressed_when_activity_already_on_today_schedule()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "Morning run");

        await CompleteAsync(userId, activity, new DateTimeOffset(2026, 6, 23, 6, 0, 0, TimeSpan.Zero));
        await CompleteAsync(userId, activity, new DateTimeOffset(2026, 6, 30, 6, 0, 0, TimeSpan.Zero));

        // Pending occurrence already scheduled for today
        await AddOccurrenceAsync(userId, activity, startAt: At(7, 6));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Empty(recs);
    }

    [Fact]
    public async Task GetAsync_tier3_requires_at_least_2_completions_on_weekday()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "Tuesday solo");

        await CompleteAsync(userId, activity, new DateTimeOffset(2026, 6, 30, 9, 0, 0, TimeSpan.Zero));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Empty(recs);
    }

    [Fact]
    public async Task GetAsync_tier3_ignores_completions_older_than_6_weeks()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "Old habit");

        await CompleteAsync(userId, activity, new DateTimeOffset(2026, 5, 19, 9, 0, 0, TimeSpan.Zero));
        await CompleteAsync(userId, activity, new DateTimeOffset(2026, 5, 26, 9, 0, 0, TimeSpan.Zero));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Empty(recs);
    }

    [Fact]
    public async Task GetAsync_bench_goal_activity_never_surfaces()
    {
        var userId = await CreateUserAsync();
        await AddActivityAsync(userId, "bench task", GoalStatus.bench);

        var alone = await _ctx.RecommendationService.GetAsync(userId, Today, Now);
        Assert.Empty(alone);

        await AddActivityAsync(userId, "focus task", GoalStatus.focus);

        var withFocus = await _ctx.RecommendationService.GetAsync(userId, Today, Now);
        Assert.Single(withFocus);
        Assert.Equal(1, withFocus[0].Tier);
    }

    [Fact]
    public async Task GetAsync_activity_appears_at_most_once()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "goal and habit", GoalStatus.active);

        // Also qualifies for tier 3 (2 Tuesday completions) — must dedupe into tier 2
        await CompleteAsync(userId, activity, new DateTimeOffset(2026, 6, 23, 9, 0, 0, TimeSpan.Zero));
        await CompleteAsync(userId, activity, new DateTimeOffset(2026, 6, 30, 9, 0, 0, TimeSpan.Zero));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Single(recs);
        Assert.Equal(2, recs[0].Tier);
        Assert.Equal(activity.Id, recs[0].Activity.Id);
    }

    [Fact]
    public async Task GetAsync_buckets_days_in_user_timezone()
    {
        var userId = await CreateUserAsync(timezone: "Europe/Zagreb");
        var todayLocal = await AddActivityAsync(userId, "today local", GoalStatus.focus);
        var tomorrowLocal = await AddActivityAsync(userId, "tomorrow local", GoalStatus.focus);

        // 21:30 UTC = 23:30 Jul 7 in Zagreb (today) — excluded; 22:30 UTC = 00:30 Jul 8 — still suggested
        await AddOccurrenceAsync(userId, todayLocal, startAt: At(7, 21, 30));
        await AddOccurrenceAsync(userId, tomorrowLocal, startAt: At(7, 22, 30));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Single(recs);
        Assert.Equal(tomorrowLocal.Id, recs[0].Activity.Id);
    }

    [Fact]
    public async Task GetAsync_ranks_more_overdue_activities_first_within_tier()
    {
        var userId = await CreateUserAsync();
        // A: every ~2 days, last done yesterday — barely due
        var recent = await AddActivityAsync(userId, "done recently", GoalStatus.active);
        await CompleteAsync(userId, recent, At(2, 9));
        await CompleteAsync(userId, recent, At(4, 9));
        await CompleteAsync(userId, recent, At(6, 9));

        // B: every ~2 days, last done 10 days ago — far past its rhythm
        var overdue = await AddActivityAsync(userId, "long overdue", GoalStatus.active);
        await CompleteAsync(userId, overdue, new DateTimeOffset(2026, 6, 23, 9, 0, 0, TimeSpan.Zero));
        await CompleteAsync(userId, overdue, new DateTimeOffset(2026, 6, 25, 9, 0, 0, TimeSpan.Zero));
        await CompleteAsync(userId, overdue, new DateTimeOffset(2026, 6, 27, 9, 0, 0, TimeSpan.Zero));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Equal(2, recs.Count);
        Assert.Equal(overdue.Id, recs[0].Activity.Id);
        Assert.Equal(recent.Id, recs[1].Activity.Id);
    }

    [Fact]
    public async Task GetAsync_downranks_activity_whose_typical_start_is_not_free()
    {
        var userId = await CreateUserAsync();
        // Same cadence; "morning" typically starts 09:00 (already past at Now=12:00), "evening" at 20:00 (still free)
        var morning = await AddActivityAsync(userId, "morning task", GoalStatus.active);
        await CompleteAsync(userId, morning, At(2, 9));
        await CompleteAsync(userId, morning, At(4, 9));
        await CompleteAsync(userId, morning, At(6, 9));

        var evening = await AddActivityAsync(userId, "evening task", GoalStatus.active);
        await CompleteAsync(userId, evening, At(2, 20));
        await CompleteAsync(userId, evening, At(4, 20));
        await CompleteAsync(userId, evening, At(6, 20));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Equal(2, recs.Count);
        Assert.Equal(evening.Id, recs[0].Activity.Id);
        Assert.Equal(morning.Id, recs[1].Activity.Id);
    }

    [Fact]
    public async Task GetAsync_past_date_skips_slot_filtering()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "hour long", GoalStatus.active);
        await CompleteAsync(userId, activity, new DateTimeOffset(2026, 6, 20, 9, 0, 0, TimeSpan.Zero), new DateTimeOffset(2026, 6, 20, 10, 0, 0, TimeSpan.Zero));
        await CompleteAsync(userId, activity, new DateTimeOffset(2026, 6, 24, 9, 0, 0, TimeSpan.Zero), new DateTimeOffset(2026, 6, 24, 10, 0, 0, TimeSpan.Zero));

        // A past day has no remaining free time; duration history must not filter everything out
        var recs = await _ctx.RecommendationService.GetAsync(userId, new DateOnly(2026, 7, 1), Now);

        Assert.Single(recs);
        Assert.Equal(activity.Id, recs[0].Activity.Id);
    }

    [Fact]
    public async Task GetAsync_future_date_computes_slots_within_that_day_only()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "hour long", GoalStatus.active);
        await CompleteAsync(userId, activity, new DateTimeOffset(2026, 6, 20, 9, 0, 0, TimeSpan.Zero), new DateTimeOffset(2026, 6, 20, 10, 0, 0, TimeSpan.Zero));
        await CompleteAsync(userId, activity, new DateTimeOffset(2026, 6, 24, 9, 0, 0, TimeSpan.Zero), new DateTimeOffset(2026, 6, 24, 10, 0, 0, TimeSpan.Zero));

        var tomorrow = new DateOnly(2026, 7, 8);

        var open = await _ctx.RecommendationService.GetAsync(userId, tomorrow, Now);
        Assert.Single(open);
        Assert.Equal(activity.Id, open[0].Activity.Id);

        // Block tomorrow 00:30-23:30: only two 30-min gaps remain, the 60-min activity no longer fits.
        // The old from-now slot math would have counted the span between now and the block as free.
        var blocker = await AddActivityAsync(userId, "blocker");
        await AddOccurrenceAsync(userId, blocker, startAt: At(8, 0, 30), endAt: At(8, 23, 30));

        var blocked = await _ctx.RecommendationService.GetAsync(userId, tomorrow, Now);
        Assert.Empty(blocked);
    }

    [Fact]
    public async Task GetAsync_timing_hints_come_from_completed_history()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "with history", GoalStatus.active);
        await CompleteAsync(userId, activity, At(2, 20), At(2, 21, 15));
        await CompleteAsync(userId, activity, At(4, 20), At(4, 21, 15));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Single(recs);
        Assert.Equal(75, recs[0].TypicalDurationMinutes);
        Assert.Equal("20:00", recs[0].TypicalStartTime);
    }

    [Fact]
    public async Task GetAsync_exposes_cadence_signals_from_history()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "every other day", GoalStatus.active);
        await CompleteAsync(userId, activity, new DateTimeOffset(2026, 6, 27, 9, 0, 0, TimeSpan.Zero));
        await CompleteAsync(userId, activity, new DateTimeOffset(2026, 6, 29, 9, 0, 0, TimeSpan.Zero));
        await CompleteAsync(userId, activity, At(1, 9));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Single(recs);
        Assert.Equal(6, recs[0].DaysSinceLast);   // last done Jul 1, target day Jul 7
        Assert.Equal(2, recs[0].MedianGapDays);
        Assert.Null(recs[0].PatternCount);
    }

    [Fact]
    public async Task GetAsync_signals_are_null_without_history()
    {
        var userId = await CreateUserAsync();
        await AddActivityAsync(userId, "never done", GoalStatus.focus);

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Single(recs);
        Assert.Null(recs[0].DaysSinceLast);
        Assert.Null(recs[0].MedianGapDays);
        Assert.Null(recs[0].PatternCount);
    }

    [Fact]
    public async Task GetAsync_tier3_exposes_weekday_pattern_count()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "Tuesday deep work");

        await CompleteAsync(userId, activity, new DateTimeOffset(2026, 6, 16, 9, 0, 0, TimeSpan.Zero));
        await CompleteAsync(userId, activity, new DateTimeOffset(2026, 6, 23, 9, 0, 0, TimeSpan.Zero));
        await CompleteAsync(userId, activity, new DateTimeOffset(2026, 6, 30, 9, 0, 0, TimeSpan.Zero));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Single(recs);
        Assert.Equal(3, recs[0].Tier);
        Assert.Equal(3, recs[0].PatternCount);
    }

    [Fact]
    public async Task GetAsync_suggests_the_habitual_start_time_when_it_is_still_free()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "evening task", GoalStatus.active);
        await CompleteAsync(userId, activity, At(2, 20), At(2, 21));
        await CompleteAsync(userId, activity, At(4, 20), At(4, 21));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Single(recs);
        Assert.Equal(At(7, 20), recs[0].SuggestedStartAt);
    }

    [Fact]
    public async Task GetAsync_suggested_start_falls_back_to_next_quarter_of_the_first_gap()
    {
        var userId = await CreateUserAsync();
        // Habitual time is 12:00, a few minutes behind us at 12:07 — well inside the drift bound,
        // so the fallback is the slot itself, rounded up to the next quarter
        var activity = await AddActivityAsync(userId, "midday task", GoalStatus.active);
        await CompleteAsync(userId, activity, At(2, 12), At(2, 13));
        await CompleteAsync(userId, activity, At(4, 12), At(4, 13));

        var now = new DateTimeOffset(2026, 7, 7, 12, 7, 0, TimeSpan.Zero);
        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, now);

        Assert.Single(recs);
        Assert.Equal(At(7, 12, 15), recs[0].SuggestedStartAt);
    }

    [Fact]
    public async Task GetAsync_no_suggested_start_when_every_opening_is_far_from_the_habitual_time()
    {
        var userId = await CreateUserAsync();
        // Habitual time is 09:00 and the day is only asked about at 19:00. Every remaining opening is
        // hours away from when this is actually done, so the engine offers no time rather than one
        // the user would never pick. The recommendation itself still stands.
        var activity = await AddActivityAsync(userId, "morning commute", GoalStatus.active);
        await CompleteAsync(userId, activity, At(2, 9), At(2, 9, 30));
        await CompleteAsync(userId, activity, At(4, 9), At(4, 9, 30));

        var evening = new DateTimeOffset(2026, 7, 7, 19, 0, 0, TimeSpan.Zero);
        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, evening);

        Assert.Single(recs);
        Assert.Equal(activity.Id, recs[0].Activity.Id);
        Assert.Null(recs[0].SuggestedStartAt);
    }

    [Fact]
    public async Task GetAsync_suggested_start_skips_a_gap_too_short_for_the_activity()
    {
        var userId = await CreateUserAsync();
        // Habitual 14:00, so 15:00 is a one hour displacement - inside the drift bound
        var activity = await AddActivityAsync(userId, "two hour block", GoalStatus.active);
        await CompleteAsync(userId, activity, At(2, 14), At(2, 16));
        await CompleteAsync(userId, activity, At(4, 14), At(4, 16));

        // Busy 12:00-13:00 and 14:00-15:00, leaving a 1h gap at 13:00 that cannot hold 2h
        var blocker = await AddActivityAsync(userId, "blocker");
        await AddOccurrenceAsync(userId, blocker, startAt: At(7, 12), endAt: At(7, 13));
        await AddOccurrenceAsync(userId, blocker, startAt: At(7, 14), endAt: At(7, 15));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Single(recs);
        Assert.Equal(At(7, 15), recs[0].SuggestedStartAt);
    }

    [Fact]
    public async Task GetAsync_past_day_has_no_suggested_start()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "hour long", GoalStatus.active);
        await CompleteAsync(userId, activity, new DateTimeOffset(2026, 6, 20, 9, 0, 0, TimeSpan.Zero), new DateTimeOffset(2026, 6, 20, 10, 0, 0, TimeSpan.Zero));

        var recs = await _ctx.RecommendationService.GetAsync(userId, new DateOnly(2026, 7, 1), Now);

        Assert.Single(recs);
        Assert.Null(recs[0].SuggestedStartAt);
    }

    [Fact]
    public async Task GetAsync_suggested_start_skips_a_gap_too_small_for_an_activity_with_no_history()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "never done", GoalStatus.active);

        // 12:00-12:15 is free but only 15 min - an unknown duration assumes 30, so it must not fit
        var blocker = await AddActivityAsync(userId, "blocker");
        await AddOccurrenceAsync(userId, blocker, startAt: At(7, 12, 15), endAt: At(7, 14));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        var rec = recs.Single(r => r.Activity.Id == activity.Id);
        Assert.Null(rec.TypicalDurationMinutes);
        Assert.Equal(At(7, 14), rec.SuggestedStartAt);
    }

    [Fact]
    public async Task GetAsync_free_slots_exclude_time_held_by_a_done_block()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "never done", GoalStatus.active);

        var blocker = await AddActivityAsync(userId, "already done");
        await AddOccurrenceAsync(userId, blocker, startAt: At(7, 12), endAt: At(7, 13), status: EventStatus.done);

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        var rec = recs.Single(r => r.Activity.Id == activity.Id);
        Assert.Equal(At(7, 13), rec.SuggestedStartAt);
    }

    [Fact]
    public async Task GetAsync_free_slots_reclaim_time_held_by_a_skipped_block()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "never done", GoalStatus.active);

        var blocker = await AddActivityAsync(userId, "not doing it");
        await AddOccurrenceAsync(userId, blocker, startAt: At(7, 12), endAt: At(7, 13), status: EventStatus.skipped);

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        var rec = recs.Single(r => r.Activity.Id == activity.Id);
        Assert.Equal(At(7, 12), rec.SuggestedStartAt);
    }

    [Fact]
    public async Task GetAsync_timing_stats_ignore_completions_older_than_90_days()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "stale history", GoalStatus.active);
        // ~100 days before Now — outside the stats window
        await CompleteAsync(userId, activity, new DateTimeOffset(2026, 3, 29, 9, 0, 0, TimeSpan.Zero), new DateTimeOffset(2026, 3, 29, 10, 0, 0, TimeSpan.Zero));
        await CompleteAsync(userId, activity, new DateTimeOffset(2026, 4, 2, 9, 0, 0, TimeSpan.Zero), new DateTimeOffset(2026, 4, 2, 10, 0, 0, TimeSpan.Zero));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Single(recs);
        Assert.Null(recs[0].TypicalDurationMinutes);
        Assert.Null(recs[0].TypicalStartTime);
    }

    [Fact]
    public async Task GetAsync_suggestions_do_not_all_stack_on_the_first_gap()
    {
        var userId = await CreateUserAsync();
        for (var i = 0; i < 5; i++)
            await AddActivityAsync(userId, $"never done {i}", GoalStatus.active);

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);
        var starts = recs.Select(r => r.SuggestedStartAt).ToList();

        Assert.Equal(5, starts.Count);
        Assert.All(starts, s => Assert.NotNull(s));
        // Two per slot is allowed on purpose ("pick one"), five on the same one is not
        Assert.True(starts.Distinct().Count() >= 3, $"suggestions bunched up: {string.Join(", ", starts)}");
    }

    [Fact]
    public async Task GetAsync_no_more_than_two_suggestions_cover_the_same_instant()
    {
        var userId = await CreateUserAsync();
        for (var i = 0; i < 6; i++)
            await AddActivityAsync(userId, $"never done {i}", GoalStatus.active);

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);
        var spans = recs
            .Where(r => r.SuggestedStartAt is not null)
            .Select(r => (Start: r.SuggestedStartAt!.Value, End: r.SuggestedStartAt!.Value.AddMinutes(30)))
            .ToList();

        foreach (var span in spans)
        {
            var overlapping = spans.Count(o => span.Start < o.End && span.End > o.Start);
            Assert.True(overlapping <= 2, $"{overlapping} suggestions overlap at {span.Start}");
        }
    }

    [Fact]
    public async Task GetAsync_suggestion_on_a_future_day_skips_the_small_hours()
    {
        var userId = await CreateUserAsync();
        await AddActivityAsync(userId, "never done", GoalStatus.active);

        // Day boundary is midnight, so the first free slot opens at 00:00 - useless as a suggestion
        var recs = await _ctx.RecommendationService.GetAsync(userId, new DateOnly(2026, 7, 9), Now);

        Assert.Single(recs);
        Assert.Equal(At(9, 8), recs[0].SuggestedStartAt);
    }

    [Fact]
    public async Task GetAsync_displaced_suggestion_stays_near_its_habitual_time()
    {
        var userId = await CreateUserAsync();
        // Three activities that all habitually run at 20:00 - only two may share the slot
        for (var i = 0; i < 3; i++)
        {
            var a = await AddActivityAsync(userId, $"evening task {i}", GoalStatus.active);
            await CompleteAsync(userId, a, At(2, 20), At(2, 21));
            await CompleteAsync(userId, a, At(4, 20), At(4, 21));
        }

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);
        var starts = recs.Select(r => r.SuggestedStartAt).ToList();

        Assert.Equal(2, starts.Count(s => s == At(7, 20)));
        // The third lands butted up against the habit, not back at the start of the day.
        // 19:00 and 21:00 are equidistant; the tie breaks toward the earlier slot.
        var displaced = Assert.Single(starts, s => s != At(7, 20));
        Assert.Equal(At(7, 19), displaced);
    }

    // --- Activity types ---

    [Fact]
    public async Task GetAsync_deep_work_is_not_offered_a_gap_below_its_block_floor()
    {
        var userId = await CreateUserAsync();
        await AddActivityAsync(userId, "deep work", GoalStatus.focus, await DeepWorkAsync(userId));
        var normal = await AddActivityAsync(userId, "anything", GoalStatus.focus);

        // Only an hour left in the day - enough for an untyped activity, not for a 90 minute block
        var lateNow = new DateTimeOffset(2026, 7, 7, 23, 0, 0, TimeSpan.Zero);
        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, lateNow);

        var rec = Assert.Single(recs);
        Assert.Equal(normal.Id, rec.Activity.Id);
    }

    [Fact]
    public async Task GetAsync_activity_is_placed_inside_its_type_window()
    {
        var userId = await CreateUserAsync();
        await AddActivityAsync(userId, "leg day", GoalStatus.focus, await TrainingAsync(userId));

        // Future day, entirely free: without a type this would land at the 08:00 default
        var recs = await _ctx.RecommendationService.GetAsync(userId, new DateOnly(2026, 7, 9), Now);

        var rec = Assert.Single(recs);
        Assert.Equal(At(9, 15), rec.SuggestedStartAt);
    }

    [Fact]
    public async Task GetAsync_habitual_time_beats_the_type_window()
    {
        var userId = await CreateUserAsync();
        var a = await AddActivityAsync(userId, "morning run", GoalStatus.focus, await TrainingAsync(userId));
        await CompleteAsync(userId, a, At(2, 7), At(2, 8));
        await CompleteAsync(userId, a, At(4, 7), At(4, 8));

        var recs = await _ctx.RecommendationService.GetAsync(userId, new DateOnly(2026, 7, 9), Now);

        // 07:00 is outside the training window, but observed behaviour wins over a declared preference
        var rec = Assert.Single(recs);
        Assert.Equal(At(9, 7), rec.SuggestedStartAt);
    }

    [Fact]
    public async Task GetAsync_cold_start_ranks_by_the_type_cadence_prior()
    {
        var userId = await CreateUserAsync();
        // Same goal status, same age, no history: only the cadence prior separates them
        var general = await AddActivityAsync(userId, "anything", GoalStatus.focus, null, At(1, 0));
        var training = await AddActivityAsync(userId, "push day", GoalStatus.focus, await TrainingAsync(userId), At(1, 0));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Equal(2, recs.Count);
        Assert.Equal(training.Id, recs[0].Activity.Id);
        Assert.Equal(general.Id, recs[1].Activity.Id);
    }

    [Fact]
    public async Task GetAsync_cold_start_score_does_not_run_away_with_age()
    {
        var userId = await CreateUserAsync();
        // Created 300 days ago and never done: uncapped, 300/7 would bury a genuinely overdue activity
        await AddActivityAsync(userId, "ancient", GoalStatus.focus, null, At(1, 0).AddDays(-300));
        var real = await AddActivityAsync(userId, "real rhythm", GoalStatus.focus);
        await CompleteAsync(userId, real, At(1, 9), At(1, 10));
        await CompleteAsync(userId, real, At(2, 9), At(2, 10));

        // Targets a future day so the 09:00 habitual slot is still free and takes no mismatch penalty
        var recs = await _ctx.RecommendationService.GetAsync(userId, new DateOnly(2026, 7, 9), Now);

        // 7 days since last against a 1 day median gap beats the cold-start ceiling of 3
        Assert.Equal(real.Id, recs[0].Activity.Id);
    }

    [Fact]
    public async Task GetAsync_training_is_capped_at_two_a_day()
    {
        var userId = await CreateUserAsync();
        for (var i = 0; i < 3; i++)
            await AddActivityAsync(userId, $"session {i}", GoalStatus.focus, await TrainingAsync(userId));

        var recs = await _ctx.RecommendationService.GetAsync(userId, new DateOnly(2026, 7, 9), Now);

        // Two leaves room for a run alongside a lift; the cooldown is what spaces sessions out
        Assert.Equal(2, recs.Count);
        Assert.Equal(At(9, 15), recs[0].SuggestedStartAt);
    }

    // --- Cooldown ---

    [Fact]
    public async Task GetAsync_cooldown_holds_a_session_back_and_surfaces_the_other_half_of_the_split()
    {
        var userId = await CreateUserAsync();
        // Push: last done 3 days ago on a 3 day rhythm, so due. Pull: done yesterday on a 4 day
        // rhythm, so a quarter of the way through it.
        var push = await AddActivityAsync(userId, "push", GoalStatus.focus, await TrainingAsync(userId));
        await CompleteAsync(userId, push, At(1, 17), At(1, 18));
        await CompleteAsync(userId, push, At(4, 17), At(4, 18));

        var pull = await AddActivityAsync(userId, "pull", GoalStatus.focus, await TrainingAsync(userId));
        await CompleteAsync(userId, pull, At(2, 17), At(2, 18));
        await CompleteAsync(userId, pull, At(6, 17), At(6, 18));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        // Both fit the day and the cap is 2, so only the cooldown separates them
        var rec = Assert.Single(recs);
        Assert.Equal(push.Id, rec.Activity.Id);
    }

    [Fact]
    public async Task GetAsync_cooldown_does_not_apply_to_an_activity_with_no_history()
    {
        var userId = await CreateUserAsync();
        // Due-ness for a never-completed activity comes from its creation date, which says nothing
        // about rest - a brand new training activity must still be offered.
        var fresh = await AddActivityAsync(userId, "push", GoalStatus.focus, await TrainingAsync(userId), At(7, 0));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        var rec = Assert.Single(recs);
        Assert.Equal(fresh.Id, rec.Activity.Id);
    }

    [Fact]
    public async Task GetAsync_cooldown_only_applies_to_types_that_declare_one()
    {
        var userId = await CreateUserAsync();
        // Same history as the held-back session above, but untyped: general declares no cooldown
        var a = await AddActivityAsync(userId, "anything", GoalStatus.focus);
        await CompleteAsync(userId, a, At(2, 17), At(2, 18));
        await CompleteAsync(userId, a, At(6, 17), At(6, 18));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Single(recs);
    }

    [Fact]
    public async Task GetAsync_training_is_not_offered_a_gap_below_its_block_floor()
    {
        var userId = await CreateUserAsync();
        await AddActivityAsync(userId, "push", GoalStatus.focus, await TrainingAsync(userId));
        var normal = await AddActivityAsync(userId, "anything", GoalStatus.focus);

        // Half an hour left in the day: enough for an untyped activity, not for a 45 minute session
        var lateNow = new DateTimeOffset(2026, 7, 7, 23, 30, 0, TimeSpan.Zero);
        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, lateNow);

        var rec = Assert.Single(recs);
        Assert.Equal(normal.Id, rec.Activity.Id);
    }

    [Fact]
    public async Task GetAsync_type_cap_limits_suggestions_per_day()
    {
        var userId = await CreateUserAsync();
        for (var i = 0; i < 3; i++)
            await AddActivityAsync(userId, $"deep {i}", GoalStatus.focus, await DeepWorkAsync(userId));

        var recs = await _ctx.RecommendationService.GetAsync(userId, new DateOnly(2026, 7, 9), Now);

        Assert.Equal(2, recs.Count);
    }

    [Fact]
    public async Task GetAsync_type_cap_counts_activities_already_scheduled_that_day()
    {
        var userId = await CreateUserAsync();
        var target = new DateOnly(2026, 7, 9);
        for (var i = 0; i < 2; i++)
        {
            var scheduled = await AddActivityAsync(userId, $"scheduled deep {i}", GoalStatus.focus, await DeepWorkAsync(userId));
            await AddOccurrenceAsync(userId, scheduled, At(9, 9 + i * 2), At(9, 10 + i * 2));
        }
        await AddActivityAsync(userId, "one more", GoalStatus.focus, await DeepWorkAsync(userId));

        var recs = await _ctx.RecommendationService.GetAsync(userId, target, Now);

        // The day already holds two deep work blocks, so a third is not offered even though it fits
        Assert.Empty(recs);
    }

    [Fact]
    public async Task GetAsync_type_cap_counts_activities_already_completed_that_day()
    {
        var userId = await CreateUserAsync();
        for (var i = 0; i < 2; i++)
        {
            var finished = await AddActivityAsync(userId, $"finished deep {i}", GoalStatus.focus, await DeepWorkAsync(userId));
            await CompleteAsync(userId, finished, At(7, 8 + i * 2), At(7, 9 + i * 2));
        }
        await AddActivityAsync(userId, "one more", GoalStatus.focus, await DeepWorkAsync(userId));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        // Two deep work blocks are done for the day. Completing them must not reset the cap and
        // invite a third, which is what counting only pending occurrences used to do.
        Assert.Empty(recs);
    }

    // --- Types the user authored ---
    // Nothing distinguishes these from the seeded three: the engine reads whatever the row says.

    [Fact]
    public async Task GetAsync_placement_follows_a_narrow_custom_window()
    {
        var userId = await CreateUserAsync();
        var errands = await TypeAsync(userId, "Errands", new(10, 0), new(12, 0));
        await AddActivityAsync(userId, "post office", GoalStatus.focus, errands);

        var recs = await _ctx.RecommendationService.GetAsync(userId, new DateOnly(2026, 7, 9), Now);

        // With no type this would land at the 08:00 unconstrained default
        Assert.Equal(At(9, 10), Assert.Single(recs).SuggestedStartAt);
    }

    [Fact]
    public async Task GetAsync_type_cap_follows_a_custom_max_per_day()
    {
        var userId = await CreateUserAsync();
        var once = await TypeAsync(userId, "Once daily", new(9, 0), new(17, 0), maxPerDay: 1);
        for (var i = 0; i < 3; i++)
            await AddActivityAsync(userId, $"task {i}", GoalStatus.focus, once);

        var recs = await _ctx.RecommendationService.GetAsync(userId, new DateOnly(2026, 7, 9), Now);

        Assert.Single(recs);
    }

    [Fact]
    public async Task GetAsync_slot_fit_follows_a_custom_block_floor()
    {
        var userId = await CreateUserAsync();
        // A 30 minute floor rather than deep work's 90, so the last hour of the day still fits it
        var shallow = await TypeAsync(userId, "Shallow work", new(9, 0), new(17, 0), minBlockMinutes: 30);
        await AddActivityAsync(userId, "inbox", GoalStatus.focus, shallow);

        var lateNow = new DateTimeOffset(2026, 7, 7, 23, 0, 0, TimeSpan.Zero);
        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, lateNow);

        Assert.Single(recs);
    }

    [Fact]
    public async Task GetAsync_activity_with_no_type_is_unconstrained()
    {
        var userId = await CreateUserAsync();
        // No block floor, no cap and the widest window: a typeless activity takes the last gap of the
        // day, which every seeded type's block floor would have ruled out.
        await AddActivityAsync(userId, "anything", GoalStatus.focus);

        var lateNow = new DateTimeOffset(2026, 7, 7, 23, 0, 0, TimeSpan.Zero);
        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, lateNow);

        Assert.Single(recs);
    }

    // --- States ---

    /// <summary>A state whose values are given in order. The first one is the default.</summary>
    private async Task<State> AddStateAsync(Guid userId, string name, params string[] values)
    {
        var state = new State { UserId = userId, Name = name };
        for (var i = 0; i < values.Length; i++)
            state.Values.Add(new StateValue
            {
                StateId = state.Id,
                Name = values[i],
                IsDefault = i == 0,
                CreatedAt = Now.AddSeconds(i),
            });
        _ctx.Db.States.Add(state);
        await _ctx.Db.SaveChangesAsync();
        return state;
    }

    private static StateValue Value(State state, string name) => state.Values.First(v => v.Name == name);

    /// <summary>
    /// Doing this activity puts the state into that value, from the occurrence's end, holding it for
    /// <paramref name="durationMinutes"/> or until something else changes it.
    /// </summary>
    private async Task SetsAsync(Activity activity, StateValue value, int? durationMinutes = null)
    {
        _ctx.Db.ActivityStateEffects.Add(new ActivityStateEffect
        {
            ActivityId = activity.Id,
            StateId = value.StateId,
            StateValueId = value.Id,
            DurationMinutes = durationMinutes,
        });
        await _ctx.Db.SaveChangesAsync();
    }

    /// <summary>Values are ORed. Call twice for two states, which are ANDed.</summary>
    private async Task RequiresAsync(Activity activity, params StateValue[] values)
    {
        foreach (var value in values)
            _ctx.Db.ActivityStateRequirements.Add(new ActivityStateRequirement
            {
                ActivityId = activity.Id,
                StateValueId = value.Id,
            });
        await _ctx.Db.SaveChangesAsync();
    }

    [Fact]
    public async Task GetAsync_activity_is_not_suggested_when_its_requirement_never_holds()
    {
        var userId = await CreateUserAsync();
        var location = await AddStateAsync(userId, "Location", "Home", "Work");

        // On a focus goal and overdue by its own reckoning, but nobody went in that day, so there is
        // nothing for a commute home to be a commute from.
        var back = await AddActivityAsync(userId, "commute home", GoalStatus.focus);
        await RequiresAsync(back, Value(location, "Work"));

        var recs = await _ctx.RecommendationService.GetAsync(userId, new DateOnly(2026, 7, 9), Now);

        Assert.Empty(recs);
    }

    [Fact]
    public async Task GetAsync_requirement_opens_from_the_setting_occurrences_end()
    {
        var userId = await CreateUserAsync();
        var location = await AddStateAsync(userId, "Location", "Home", "Work");

        // You are at work once the inbound leg *finishes*, so nothing may be placed before 08:30.
        var into = await AddActivityAsync(userId, "commute in");
        await SetsAsync(into, Value(location, "Work"));
        await AddOccurrenceAsync(userId, into, startAt: At(9, 8), endAt: At(9, 8, 30));

        var back = await AddActivityAsync(userId, "commute home", GoalStatus.focus);
        await RequiresAsync(back, Value(location, "Work"));

        var recs = await _ctx.RecommendationService.GetAsync(userId, new DateOnly(2026, 7, 9), Now);

        Assert.Equal(At(9, 8, 30), Assert.Single(recs).SuggestedStartAt);
    }

    [Fact]
    public async Task GetAsync_requirement_overrides_a_habitual_time_outside_it()
    {
        var userId = await CreateUserAsync();
        var location = await AddStateAsync(userId, "Location", "Home", "Work");

        var into = await AddActivityAsync(userId, "commute in");
        await SetsAsync(into, Value(location, "Work"));
        await AddOccurrenceAsync(userId, into, startAt: At(9, 8), endAt: At(9, 8, 30));

        // Habitually an 08:00 activity, which is before the state permits it. A habitual time beats a
        // type's window, but not a requirement: the mask is the one thing placement cannot step over.
        var back = await AddActivityAsync(userId, "swipe out", GoalStatus.focus);
        await RequiresAsync(back, Value(location, "Work"));
        foreach (var day in new[] { 2, 6 })
            await CompleteAsync(userId, back, At(day, 8), At(day, 8, 30));

        var recs = await _ctx.RecommendationService.GetAsync(userId, new DateOnly(2026, 7, 9), Now);

        Assert.Equal(At(9, 8, 30), Assert.Single(recs).SuggestedStartAt);
    }

    [Fact]
    public async Task GetAsync_activity_is_suppressed_while_a_timed_value_is_in_force()
    {
        var userId = await CreateUserAsync();
        var tired = await AddStateAsync(userId, "Tired", "No", "Yes");

        // Trained 09:00-10:00, so tired until 10:00 tomorrow. Nothing has to be scheduled to undo it.
        var legs = await AddActivityAsync(userId, "leg day");
        await SetsAsync(legs, Value(tired, "Yes"), 1440);
        await CompleteAsync(userId, legs, At(7, 9), At(7, 10));

        var run = await AddActivityAsync(userId, "easy run", GoalStatus.focus);
        await RequiresAsync(run, Value(tired, "No"));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Empty(recs);
    }

    [Fact]
    public async Task GetAsync_activity_returns_once_a_timed_value_has_expired()
    {
        var userId = await CreateUserAsync();
        var tired = await AddStateAsync(userId, "Tired", "No", "Yes");

        var legs = await AddActivityAsync(userId, "leg day");
        await SetsAsync(legs, Value(tired, "Yes"), 120);
        await CompleteAsync(userId, legs, At(7, 9), At(7, 10));

        var run = await AddActivityAsync(userId, "easy run", GoalStatus.focus);
        await RequiresAsync(run, Value(tired, "No"));

        // Two hours from 10:00 puts the state back to No at 12:00, with no occurrence saying so.
        var afterExpiry = At(7, 12, 30);
        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, afterExpiry);

        Assert.Equal(At(7, 12, 30), Assert.Single(recs).SuggestedStartAt);
    }

    [Fact]
    public async Task GetAsync_a_timed_value_carries_across_the_day_boundary()
    {
        var userId = await CreateUserAsync();
        var tired = await AddStateAsync(userId, "Tired", "No", "Yes");

        // Two days of soreness from a Tuesday afternoon session, which day-scoped gating could not
        // express at all.
        var legs = await AddActivityAsync(userId, "max squats");
        await SetsAsync(legs, Value(tired, "Yes"), 2880);
        await CompleteAsync(userId, legs, At(7, 12), At(7, 13));

        var run = await AddActivityAsync(userId, "easy run", GoalStatus.focus);
        await RequiresAsync(run, Value(tired, "No"));

        var recs = await _ctx.RecommendationService.GetAsync(userId, new DateOnly(2026, 7, 8), Now);

        Assert.Empty(recs);
    }

    [Fact]
    public async Task GetAsync_the_expiry_comes_from_the_activity_that_set_the_value()
    {
        var userId = await CreateUserAsync();
        var tired = await AddStateAsync(userId, "Tired", "No", "Yes");

        // One value, two causes: a walk wears off in two hours and a hike takes two days. This is the
        // whole reason the duration sits on the effect rather than on the value.
        var walk = await AddActivityAsync(userId, "walk");
        await SetsAsync(walk, Value(tired, "Yes"), 120);
        var hike = await AddActivityAsync(userId, "hike");
        await SetsAsync(hike, Value(tired, "Yes"), 2880);

        await CompleteAsync(userId, walk, At(7, 9), At(7, 10));

        var run = await AddActivityAsync(userId, "easy run", GoalStatus.focus);
        await RequiresAsync(run, Value(tired, "No"));

        // The walk's two hours from 10:00, not the hike's two days.
        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, At(7, 12, 30));

        Assert.Equal(At(7, 12, 30), Assert.Single(recs).SuggestedStartAt);
    }

    [Fact]
    public async Task GetAsync_a_later_setter_does_not_shorten_a_longer_expiry()
    {
        var userId = await CreateUserAsync();
        var tired = await AddStateAsync(userId, "Tired", "No", "Yes");

        var hike = await AddActivityAsync(userId, "hike");
        await SetsAsync(hike, Value(tired, "Yes"), 2880);
        var walk = await AddActivityAsync(userId, "walk");
        await SetsAsync(walk, Value(tired, "Yes"), 120);

        // Two days of soreness from the hike, then an easy walk while still sore. Re-setting the value
        // already in force takes the further expiry, so the walk cannot declare you recovered by 13:00.
        await CompleteAsync(userId, hike, At(7, 8), At(7, 9));
        await CompleteAsync(userId, walk, At(7, 11), At(7, 12));

        var run = await AddActivityAsync(userId, "easy run", GoalStatus.focus);
        await RequiresAsync(run, Value(tired, "No"));

        var recs = await _ctx.RecommendationService.GetAsync(userId, new DateOnly(2026, 7, 8), Now);

        Assert.Empty(recs);
    }

    [Fact]
    public async Task GetAsync_a_later_setter_extends_a_pending_expiry()
    {
        var userId = await CreateUserAsync();
        var tired = await AddStateAsync(userId, "Tired", "No", "Yes");

        var legs = await AddActivityAsync(userId, "leg day");
        await SetsAsync(legs, Value(tired, "Yes"), 120);
        // First session would have worn off at 11:00; the second one pushes it out to 12:30.
        await CompleteAsync(userId, legs, At(7, 8), At(7, 9));
        await CompleteAsync(userId, legs, At(7, 10), At(7, 10, 30));

        var run = await AddActivityAsync(userId, "easy run", GoalStatus.focus);
        await RequiresAsync(run, Value(tired, "No"));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Equal(At(7, 12, 30), Assert.Single(recs).SuggestedStartAt);
    }

    [Fact]
    public async Task GetAsync_a_skipped_setter_leaves_the_state_alone()
    {
        var userId = await CreateUserAsync();
        var location = await AddStateAsync(userId, "Location", "Home", "Work");

        // Skipping is an explicit decision not to, the same reason a skipped block frees its time.
        var into = await AddActivityAsync(userId, "commute in");
        await SetsAsync(into, Value(location, "Work"));
        await AddOccurrenceAsync(userId, into, At(9, 8), At(9, 8, 30), EventStatus.skipped);

        var back = await AddActivityAsync(userId, "commute home", GoalStatus.focus);
        await RequiresAsync(back, Value(location, "Work"));

        var recs = await _ctx.RecommendationService.GetAsync(userId, new DateOnly(2026, 7, 9), Now);

        Assert.Empty(recs);
    }

    [Fact]
    public async Task GetAsync_requirements_on_two_states_must_both_hold()
    {
        var userId = await CreateUserAsync();
        var location = await AddStateAsync(userId, "Location", "Home", "Work");
        var tired = await AddStateAsync(userId, "Tired", "No", "Yes");

        var into = await AddActivityAsync(userId, "commute in");
        await SetsAsync(into, Value(location, "Work"));
        await AddOccurrenceAsync(userId, into, startAt: At(7, 8), endAt: At(7, 8, 30));

        // Rested all day, but at work from 08:30, and the remaining day is all after that.
        var run = await AddActivityAsync(userId, "easy run", GoalStatus.focus);
        await RequiresAsync(run, Value(location, "Home"));
        await RequiresAsync(run, Value(tired, "No"));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Empty(recs);
    }

    [Fact]
    public async Task GetAsync_a_requirement_listing_two_values_holds_for_either()
    {
        var userId = await CreateUserAsync();
        var location = await AddStateAsync(userId, "Location", "Home", "Work", "OnTrip");

        var flight = await AddActivityAsync(userId, "fly out");
        await SetsAsync(flight, Value(location, "OnTrip"));
        await AddOccurrenceAsync(userId, flight, startAt: At(7, 8), endAt: At(7, 8, 30));

        // Home before the flight and away after it, so the two allowed stretches meet and the whole
        // day is open.
        var stretch = await AddActivityAsync(userId, "stretch", GoalStatus.focus);
        await RequiresAsync(stretch, Value(location, "Home"), Value(location, "OnTrip"));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Equal(At(7, 12), Assert.Single(recs).SuggestedStartAt);
    }

    [Fact]
    public async Task GetAsync_an_activity_without_requirements_ignores_states_entirely()
    {
        var userId = await CreateUserAsync();
        var location = await AddStateAsync(userId, "Location", "Home", "Work");

        var into = await AddActivityAsync(userId, "commute in");
        await SetsAsync(into, Value(location, "Work"));
        await AddOccurrenceAsync(userId, into, startAt: At(7, 8), endAt: At(7, 8, 30));

        var admin = await AddActivityAsync(userId, "inbox", GoalStatus.focus);

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Equal(admin.Id, Assert.Single(recs).Activity.Id);
    }

    [Fact]
    public async Task GetAsync_suggestion_is_never_placed_past_its_window_end()
    {
        var userId = await CreateUserAsync();
        await AddActivityAsync(userId, "leg day", GoalStatus.focus, await TrainingAsync(userId));

        // 21:30, past the 21:00 end of the training window. There is room left in the day and the
        // fallback used to take it, which is how a workout ghost landed at 22:45.
        var lateNow = new DateTimeOffset(2026, 7, 7, 21, 30, 0, TimeSpan.Zero);
        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, lateNow);

        Assert.Null(Assert.Single(recs).SuggestedStartAt);
    }

    [Fact]
    public async Task GetAsync_typeless_activity_has_no_window_end_to_be_placed_past()
    {
        var userId = await CreateUserAsync();
        await AddActivityAsync(userId, "read", GoalStatus.focus);

        // Same late hour that leaves a typed activity with no slot. "No type" promises no scheduling
        // constraints, so a free evening is a free evening: the only bound left is the end of the day.
        var lateNow = new DateTimeOffset(2026, 7, 7, 21, 30, 0, TimeSpan.Zero);
        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, lateNow);

        Assert.Equal(At(7, 21, 30), Assert.Single(recs).SuggestedStartAt);
    }

    [Fact]
    public async Task GetAsync_typeless_activity_is_still_held_to_the_civil_hour_floor()
    {
        var userId = await CreateUserAsync();
        await AddActivityAsync(userId, "read", GoalStatus.focus);

        // Having no window does not mean a ghost at 04:00. The 08:00 floor is a global engine rule
        // every activity gets, not something a type was supplying.
        var recs = await _ctx.RecommendationService.GetAsync(userId, new DateOnly(2026, 7, 9), Now);

        Assert.Equal(At(9, 8), Assert.Single(recs).SuggestedStartAt);
    }

    // --- All-day occurrences ---
    // All-day *and* planned is intent with no position on the clock, and the user drags those between
    // days freely. The engine ignores them outright. The other two combinations are real: all-day
    // alone is a date-only commitment, planned alone is a window.

    /// <summary>An all-day planned occurrence: a date and nothing more, as the Plan action writes it.</summary>
    private Task<Occurrence> AddIntentAsync(
        Guid userId, Activity activity, DateTimeOffset date,
        DateTimeOffset? endDate = null, EventStatus status = EventStatus.pending) =>
        AddOccurrenceAsync(userId, activity, date, endDate, status, isAllDay: true, isPlanned: true);

    [Fact]
    public async Task GetAsync_planned_all_day_occurrence_does_not_suppress_its_activity()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "sometime today", GoalStatus.focus);
        await AddIntentAsync(userId, activity, At(7, 0));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        // Planning it for "some point today" is a wish, not a commitment: it neither counts as having
        // done the thing nor stops the panel offering it a time.
        Assert.Equal(activity.Id, Assert.Single(recs).Activity.Id);
    }

    [Fact]
    public async Task GetAsync_date_only_commitment_still_suppresses_its_activity()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "on the day", GoalStatus.focus);
        await AddOccurrenceAsync(userId, activity, startAt: At(7, 0), isAllDay: true);

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        // All-day without IsPlanned is a firm commitment to the date, so the day does hold it.
        Assert.Empty(recs);
    }

    [Fact]
    public async Task GetAsync_planned_all_day_occurrence_does_not_take_a_type_slot()
    {
        var userId = await CreateUserAsync();
        var target = new DateOnly(2026, 7, 9);
        // Deep work caps at two a day. Two of them are pencilled in as all-day intents, which must not
        // consume the cap. Neither is goal-linked, so only the third can surface.
        for (var i = 0; i < 2; i++)
        {
            var pencilled = await AddActivityAsync(userId, $"maybe deep {i}", typeId: await DeepWorkAsync(userId));
            await AddIntentAsync(userId, pencilled, At(9, 0));
        }
        var real = await AddActivityAsync(userId, "one more", GoalStatus.focus, await DeepWorkAsync(userId));

        var recs = await _ctx.RecommendationService.GetAsync(userId, target, Now);

        Assert.Equal(real.Id, Assert.Single(recs).Activity.Id);
    }

    [Fact]
    public async Task GetAsync_planned_all_day_occurrence_does_not_block_time()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "never done", GoalStatus.active);

        // A multi-day all-day intent, whose EndAt is an exclusive end *date*. Read as a span it covers
        // the target day end to end and leaves the day with no free time at all.
        var away = await AddActivityAsync(userId, "trip");
        await AddIntentAsync(userId, away, At(9, 0), At(11, 0));

        var recs = await _ctx.RecommendationService.GetAsync(userId, new DateOnly(2026, 7, 9), Now);

        var rec = recs.Single(r => r.Activity.Id == activity.Id);
        Assert.Equal(At(9, 8), rec.SuggestedStartAt);
    }

    [Fact]
    public async Task GetAsync_planned_all_day_occurrence_does_not_set_a_state()
    {
        var userId = await CreateUserAsync();
        var location = await AddStateAsync(userId, "Location", "Home", "Work");

        // "Go in at some point on Thursday" does not put you at work at any particular time, so there
        // is still nothing for a commute home to be a commute from.
        var into = await AddActivityAsync(userId, "commute in");
        await SetsAsync(into, Value(location, "Work"));
        await AddIntentAsync(userId, into, At(9, 0));

        var back = await AddActivityAsync(userId, "commute home", GoalStatus.focus);
        await RequiresAsync(back, Value(location, "Work"));

        var recs = await _ctx.RecommendationService.GetAsync(userId, new DateOnly(2026, 7, 9), Now);

        Assert.Empty(recs);
    }

    [Fact]
    public async Task GetAsync_all_day_completion_feeds_cadence_but_not_the_habitual_time()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "date only habit", GoalStatus.active);
        foreach (var day in new[] { 2, 5 })
            await AddOccurrenceAsync(userId, activity, At(day, 0), status: EventStatus.done, isAllDay: true);

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        var rec = Assert.Single(recs);
        // Done on those days, so the cadence figures stand. But local midnight is not a start time:
        // left in, a run of these makes 00:00 look habitual and drags placement to the day boundary.
        Assert.Equal(2, rec.DaysSinceLast);
        Assert.Equal(3, rec.MedianGapDays);
        Assert.Null(rec.TypicalStartTime);
        Assert.Equal(At(7, 12), rec.SuggestedStartAt);
    }
}
