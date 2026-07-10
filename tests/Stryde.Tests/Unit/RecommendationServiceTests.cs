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

    private async Task<(Activity activity, Occurrence occurrence)> AddOccurrenceAsync(
        Guid userId, string title,
        DateTimeOffset? startAt = null, DateTimeOffset? endAt = null,
        GoalStatus? goalStatus = null, EventStatus status = EventStatus.pending,
        Activity? existingActivity = null)
    {
        var activity = existingActivity;
        if (activity is null)
        {
            Goal? goal = null;
            if (goalStatus.HasValue)
            {
                goal = new Goal { UserId = userId, Title = title + " goal", Status = goalStatus.Value };
                _ctx.Db.Goals.Add(goal);
                await _ctx.Db.SaveChangesAsync();
            }
            activity = new Activity { UserId = userId, Title = title, GoalId = goal?.Id };
            _ctx.Db.Activities.Add(activity);
            await _ctx.Db.SaveChangesAsync();
        }

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
        return (activity, o);
    }

    private async Task<Activity> AddActivityAsync(Guid userId, string title, GoalStatus goalStatus = GoalStatus.active)
    {
        var goal = new Goal { UserId = userId, Title = title + " goal", Status = goalStatus };
        _ctx.Db.Goals.Add(goal);
        await _ctx.Db.SaveChangesAsync();
        var activity = new Activity { UserId = userId, Title = title, GoalId = goal.Id };
        _ctx.Db.Activities.Add(activity);
        await _ctx.Db.SaveChangesAsync();
        return activity;
    }

    private static readonly DateTimeOffset Now = new(2026, 7, 7, 12, 0, 0, TimeSpan.Zero); // Tuesday
    private static readonly DateOnly Today = new(2026, 7, 7);

    [Fact]
    public async Task GetAsync_tier1_returns_floating_focus_occurrences()
    {
        var userId = await CreateUserAsync();
        var (_, focus) = await AddOccurrenceAsync(userId, "focus task", goalStatus: GoalStatus.focus);
        var (_, active) = await AddOccurrenceAsync(userId, "active task", goalStatus: GoalStatus.active);

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Equal(2, recs.Count);
        Assert.Equal(1, recs[0].Tier);
        Assert.Equal("occurrence", recs[0].Type);
        Assert.Equal(focus.Id, recs[0].Occurrence!.Id);
        Assert.Equal(2, recs[1].Tier);
        Assert.Equal(active.Id, recs[1].Occurrence!.Id);
    }

    [Fact]
    public async Task GetAsync_scheduled_occurrences_are_not_recommended()
    {
        var userId = await CreateUserAsync();
        await AddOccurrenceAsync(userId, "today scheduled",
            startAt: new DateTimeOffset(2026, 7, 7, 9, 0, 0, TimeSpan.Zero),
            goalStatus: GoalStatus.focus);
        await AddOccurrenceAsync(userId, "overdue",
            startAt: new DateTimeOffset(2026, 7, 5, 9, 0, 0, TimeSpan.Zero),
            goalStatus: GoalStatus.active);

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Empty(recs);
    }

    [Fact]
    public async Task GetAsync_tier3_surfaces_activities_with_weekday_pattern()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "Tuesday deep work");

        // 2 completions on Tuesdays: Jun 23 and Jun 30
        await AddOccurrenceAsync(userId, "Tuesday deep work",
            startAt: new DateTimeOffset(2026, 6, 23, 9, 0, 0, TimeSpan.Zero),
            status: EventStatus.done, existingActivity: activity);
        await AddOccurrenceAsync(userId, "Tuesday deep work",
            startAt: new DateTimeOffset(2026, 6, 30, 9, 0, 0, TimeSpan.Zero),
            status: EventStatus.done, existingActivity: activity);

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

        await AddOccurrenceAsync(userId, "Morning run",
            startAt: new DateTimeOffset(2026, 6, 23, 6, 0, 0, TimeSpan.Zero),
            status: EventStatus.done, existingActivity: activity);
        await AddOccurrenceAsync(userId, "Morning run",
            startAt: new DateTimeOffset(2026, 6, 30, 6, 0, 0, TimeSpan.Zero),
            status: EventStatus.done, existingActivity: activity);

        // Pending occurrence already scheduled for today
        await AddOccurrenceAsync(userId, "Morning run",
            startAt: new DateTimeOffset(2026, 7, 7, 6, 0, 0, TimeSpan.Zero),
            existingActivity: activity);

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Empty(recs);
    }

    [Fact]
    public async Task GetAsync_tier3_requires_at_least_2_completions_on_weekday()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "Tuesday solo");

        await AddOccurrenceAsync(userId, "Tuesday solo",
            startAt: new DateTimeOffset(2026, 6, 30, 9, 0, 0, TimeSpan.Zero),
            status: EventStatus.done, existingActivity: activity);

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Empty(recs);
    }

    [Fact]
    public async Task GetAsync_tier4_bench_surfaces_only_when_tiers_1_to_3_empty()
    {
        var userId = await CreateUserAsync();
        var (_, bench) = await AddOccurrenceAsync(userId, "bench task", goalStatus: GoalStatus.bench);

        var alone = await _ctx.RecommendationService.GetAsync(userId, Today, Now);
        Assert.Single(alone);
        Assert.Equal(4, alone[0].Tier);
        Assert.Equal(bench.Id, alone[0].Occurrence!.Id);

        await AddOccurrenceAsync(userId, "focus task", goalStatus: GoalStatus.focus);

        var withFocus = await _ctx.RecommendationService.GetAsync(userId, Today, Now);
        Assert.DoesNotContain(withFocus, r => r.Occurrence?.Id == bench.Id);
    }

    [Fact]
    public async Task GetAsync_occurrence_appears_at_most_once()
    {
        var userId = await CreateUserAsync();
        var (_, o) = await AddOccurrenceAsync(userId, "focus task", goalStatus: GoalStatus.focus);

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Single(recs);
        Assert.Equal(o.Id, recs[0].Occurrence!.Id);
    }

    [Fact]
    public async Task GetAsync_excludes_done_and_skipped_occurrences()
    {
        var userId = await CreateUserAsync();
        await AddOccurrenceAsync(userId, "done task", goalStatus: GoalStatus.focus, status: EventStatus.done);
        await AddOccurrenceAsync(userId, "skipped task", goalStatus: GoalStatus.active, status: EventStatus.skipped);

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Empty(recs);
    }

    [Fact]
    public async Task GetAsync_tier3_ignores_completions_older_than_6_weeks()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "Old habit");

        await AddOccurrenceAsync(userId, "Old habit",
            startAt: new DateTimeOffset(2026, 5, 19, 9, 0, 0, TimeSpan.Zero),
            status: EventStatus.done, existingActivity: activity);
        await AddOccurrenceAsync(userId, "Old habit",
            startAt: new DateTimeOffset(2026, 5, 26, 9, 0, 0, TimeSpan.Zero),
            status: EventStatus.done, existingActivity: activity);

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Empty(recs);
    }

    [Fact]
    public async Task GetAsync_buckets_days_in_user_timezone()
    {
        var userId = await CreateUserAsync(timezone: "Europe/Zagreb");
        await AddOccurrenceAsync(userId, "tomorrow local",
            startAt: new DateTimeOffset(2026, 7, 7, 22, 30, 0, TimeSpan.Zero),
            goalStatus: GoalStatus.focus);

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Empty(recs);
    }
}
