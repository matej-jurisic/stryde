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
        ActivityType type = ActivityType.general, DateTimeOffset? createdAt = null)
    {
        Goal? goal = null;
        if (goalStatus.HasValue)
        {
            goal = new Goal { UserId = userId, Title = title + " goal", Status = goalStatus.Value };
            _ctx.Db.Goals.Add(goal);
            await _ctx.Db.SaveChangesAsync();
        }
        var activity = new Activity { UserId = userId, Title = title, GoalId = goal?.Id, Type = type };
        // Cold-start scoring measures from creation, and the default is the real wall clock, which
        // is in the future relative to the fixed test clock.
        if (createdAt.HasValue) activity.CreatedAt = createdAt.Value;
        _ctx.Db.Activities.Add(activity);
        await _ctx.Db.SaveChangesAsync();
        return activity;
    }

    private async Task<Occurrence> AddOccurrenceAsync(
        Guid userId, Activity activity,
        DateTimeOffset? startAt = null, DateTimeOffset? endAt = null,
        EventStatus status = EventStatus.pending)
    {
        var o = new Occurrence
        {
            UserId = userId,
            ActivityId = activity.Id,
            StartAt = startAt,
            EndAt = endAt,
            Status = status,
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
        Assert.Equal("activity", recs[0].Type);
        Assert.Equal(focus.Id, recs[0].Activity!.Id);
        Assert.Equal(2, recs[1].Tier);
        Assert.Equal(active.Id, recs[1].Activity!.Id);
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
    public async Task GetAsync_activity_scheduled_on_another_day_is_still_suggested()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "overdue elsewhere", GoalStatus.active);
        await AddOccurrenceAsync(userId, activity, startAt: At(5, 9));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Single(recs);
        Assert.Equal(activity.Id, recs[0].Activity!.Id);
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
        Assert.Equal("activity", recs[0].Type);
        Assert.Equal(activity.Id, recs[0].Activity!.Id);
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
        Assert.Equal(activity.Id, recs[0].Activity!.Id);
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
        Assert.Equal(tomorrowLocal.Id, recs[0].Activity!.Id);
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
        Assert.Equal(overdue.Id, recs[0].Activity!.Id);
        Assert.Equal(recent.Id, recs[1].Activity!.Id);
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
        Assert.Equal(evening.Id, recs[0].Activity!.Id);
        Assert.Equal(morning.Id, recs[1].Activity!.Id);
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
        Assert.Equal(activity.Id, recs[0].Activity!.Id);
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
        Assert.Equal(activity.Id, open[0].Activity!.Id);

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
        // Habitual time is 09:00, already behind us at 12:07 — the slot itself is the fallback
        var activity = await AddActivityAsync(userId, "morning task", GoalStatus.active);
        await CompleteAsync(userId, activity, At(2, 9), At(2, 10));
        await CompleteAsync(userId, activity, At(4, 9), At(4, 10));

        var now = new DateTimeOffset(2026, 7, 7, 12, 7, 0, TimeSpan.Zero);
        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, now);

        Assert.Single(recs);
        Assert.Equal(At(7, 12, 15), recs[0].SuggestedStartAt);
    }

    [Fact]
    public async Task GetAsync_suggested_start_skips_a_gap_too_short_for_the_activity()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "two hour block", GoalStatus.active);
        await CompleteAsync(userId, activity, At(2, 9), At(2, 11));
        await CompleteAsync(userId, activity, At(4, 9), At(4, 11));

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

        var rec = recs.Single(r => r.Activity!.Id == activity.Id);
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

        var rec = recs.Single(r => r.Activity!.Id == activity.Id);
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

        var rec = recs.Single(r => r.Activity!.Id == activity.Id);
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
    public async Task GetAsync_unanchored_suggestion_on_a_future_day_skips_the_small_hours()
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
        await AddActivityAsync(userId, "deep work", GoalStatus.focus, ActivityType.deepWork);
        var normal = await AddActivityAsync(userId, "anything", GoalStatus.focus);

        // Only an hour left in the day - enough for an untyped activity, not for a 90 minute block
        var lateNow = new DateTimeOffset(2026, 7, 7, 23, 0, 0, TimeSpan.Zero);
        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, lateNow);

        var rec = Assert.Single(recs);
        Assert.Equal(normal.Id, rec.Activity!.Id);
    }

    [Fact]
    public async Task GetAsync_unanchored_activity_is_placed_inside_its_type_window()
    {
        var userId = await CreateUserAsync();
        await AddActivityAsync(userId, "inbox zero", GoalStatus.focus, ActivityType.admin);

        // Future day, entirely free: without a type this would land at the 08:00 default
        var recs = await _ctx.RecommendationService.GetAsync(userId, new DateOnly(2026, 7, 9), Now);

        var rec = Assert.Single(recs);
        Assert.Equal(At(9, 15), rec.SuggestedStartAt);
    }

    [Fact]
    public async Task GetAsync_habitual_time_beats_the_type_window()
    {
        var userId = await CreateUserAsync();
        var a = await AddActivityAsync(userId, "morning admin", GoalStatus.focus, ActivityType.admin);
        await CompleteAsync(userId, a, At(2, 7), At(2, 8));
        await CompleteAsync(userId, a, At(4, 7), At(4, 8));

        var recs = await _ctx.RecommendationService.GetAsync(userId, new DateOnly(2026, 7, 9), Now);

        // 07:00 is outside the admin window, but observed behaviour wins over a declared preference
        var rec = Assert.Single(recs);
        Assert.Equal(At(9, 7), rec.SuggestedStartAt);
    }

    [Fact]
    public async Task GetAsync_cold_start_ranks_by_the_type_cadence_prior()
    {
        var userId = await CreateUserAsync();
        // Same goal status, same age, no history: only the cadence prior separates them
        var chore = await AddActivityAsync(userId, "chore", GoalStatus.focus, ActivityType.chore, At(1, 0));
        var habit = await AddActivityAsync(userId, "habit", GoalStatus.focus, ActivityType.habit, At(1, 0));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Equal(2, recs.Count);
        Assert.Equal(habit.Id, recs[0].Activity!.Id);
        Assert.Equal(chore.Id, recs[1].Activity!.Id);
    }

    [Fact]
    public async Task GetAsync_cold_start_score_does_not_run_away_with_age()
    {
        var userId = await CreateUserAsync();
        // Created 300 days ago and never done: uncapped, 300/1 would bury a genuinely overdue habit
        await AddActivityAsync(userId, "ancient", GoalStatus.focus, ActivityType.habit, At(1, 0).AddDays(-300));
        var real = await AddActivityAsync(userId, "real rhythm", GoalStatus.focus, ActivityType.habit);
        await CompleteAsync(userId, real, At(1, 9), At(1, 10));
        await CompleteAsync(userId, real, At(2, 9), At(2, 10));

        // Targets a future day so the 09:00 habit slot is still free and takes no mismatch penalty
        var recs = await _ctx.RecommendationService.GetAsync(userId, new DateOnly(2026, 7, 9), Now);

        // 7 days since last against a 1 day median gap beats the cold-start ceiling of 3
        Assert.Equal(real.Id, recs[0].Activity!.Id);
    }

    [Fact]
    public async Task GetAsync_evening_habit_is_placed_after_the_morning_window()
    {
        var userId = await CreateUserAsync();
        var morning = await AddActivityAsync(userId, "stretch", GoalStatus.focus, ActivityType.habit);
        var evening = await AddActivityAsync(userId, "read", GoalStatus.focus, ActivityType.eveningHabit);

        // Future day, entirely free: the two share a cadence prior, so only the window separates them
        var recs = await _ctx.RecommendationService.GetAsync(userId, new DateOnly(2026, 7, 9), Now);

        Assert.Equal(At(9, 6), recs.Single(r => r.Activity!.Id == morning.Id).SuggestedStartAt);
        Assert.Equal(At(9, 18), recs.Single(r => r.Activity!.Id == evening.Id).SuggestedStartAt);
    }

    [Fact]
    public async Task GetAsync_training_is_capped_at_two_a_day()
    {
        var userId = await CreateUserAsync();
        for (var i = 0; i < 3; i++)
            await AddActivityAsync(userId, $"session {i}", GoalStatus.focus, ActivityType.training);

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
        var push = await AddActivityAsync(userId, "push", GoalStatus.focus, ActivityType.training);
        await CompleteAsync(userId, push, At(1, 17), At(1, 18));
        await CompleteAsync(userId, push, At(4, 17), At(4, 18));

        var pull = await AddActivityAsync(userId, "pull", GoalStatus.focus, ActivityType.training);
        await CompleteAsync(userId, pull, At(2, 17), At(2, 18));
        await CompleteAsync(userId, pull, At(6, 17), At(6, 18));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        // Both fit the day and the cap is 2, so only the cooldown separates them
        var rec = Assert.Single(recs);
        Assert.Equal(push.Id, rec.Activity!.Id);
    }

    [Fact]
    public async Task GetAsync_cooldown_does_not_apply_to_an_activity_with_no_history()
    {
        var userId = await CreateUserAsync();
        // Due-ness for a never-completed activity comes from its creation date, which says nothing
        // about rest - a brand new training activity must still be offered.
        var fresh = await AddActivityAsync(userId, "push", GoalStatus.focus, ActivityType.training, At(7, 0));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        var rec = Assert.Single(recs);
        Assert.Equal(fresh.Id, rec.Activity!.Id);
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
        await AddActivityAsync(userId, "push", GoalStatus.focus, ActivityType.training);
        var normal = await AddActivityAsync(userId, "anything", GoalStatus.focus);

        // Half an hour left in the day: enough for an untyped activity, not for a 45 minute session
        var lateNow = new DateTimeOffset(2026, 7, 7, 23, 30, 0, TimeSpan.Zero);
        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, lateNow);

        var rec = Assert.Single(recs);
        Assert.Equal(normal.Id, rec.Activity!.Id);
    }

    [Fact]
    public async Task GetAsync_type_cap_limits_suggestions_per_day()
    {
        var userId = await CreateUserAsync();
        for (var i = 0; i < 3; i++)
            await AddActivityAsync(userId, $"deep {i}", GoalStatus.focus, ActivityType.deepWork);

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
            var scheduled = await AddActivityAsync(userId, $"scheduled deep {i}", GoalStatus.focus, ActivityType.deepWork);
            await AddOccurrenceAsync(userId, scheduled, At(9, 9 + i * 2), At(9, 10 + i * 2));
        }
        await AddActivityAsync(userId, "one more", GoalStatus.focus, ActivityType.deepWork);

        var recs = await _ctx.RecommendationService.GetAsync(userId, target, Now);

        // The day already holds two deep work blocks, so a third is not offered even though it fits
        Assert.Empty(recs);
    }
}
