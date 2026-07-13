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

    private async Task<Activity> AddActivityAsync(Guid userId, string title, GoalStatus? goalStatus = null)
    {
        Goal? goal = null;
        if (goalStatus.HasValue)
        {
            goal = new Goal { UserId = userId, Title = title + " goal", Status = goalStatus.Value };
            _ctx.Db.Goals.Add(goal);
            await _ctx.Db.SaveChangesAsync();
        }
        var activity = new Activity { UserId = userId, Title = title, GoalId = goal?.Id };
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
    public async Task GetAsync_tier4_bench_surfaces_only_when_tiers_1_to_3_empty()
    {
        var userId = await CreateUserAsync();
        var bench = await AddActivityAsync(userId, "bench task", GoalStatus.bench);

        var alone = await _ctx.RecommendationService.GetAsync(userId, Today, Now);
        Assert.Single(alone);
        Assert.Equal(4, alone[0].Tier);
        Assert.Equal(bench.Id, alone[0].Activity!.Id);

        await AddActivityAsync(userId, "focus task", GoalStatus.focus);

        var withFocus = await _ctx.RecommendationService.GetAsync(userId, Today, Now);
        Assert.DoesNotContain(withFocus, r => r.Activity?.Id == bench.Id);
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
}
