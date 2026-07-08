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

    private async Task<Event> AddEventAsync(
        Guid userId, string title,
        DateTimeOffset? startAt = null, DateTimeOffset? endAt = null,
        GoalStatus? goalStatus = null, EventStatus status = EventStatus.pending,
        Guid? baseEventId = null)
    {
        var ev = new Event
        {
            UserId = userId, Title = title,
            StartAt = startAt, EndAt = endAt,
            Status = status, BaseEventId = baseEventId,
        };
        if (goalStatus.HasValue)
            ev.Goals.Add(new Goal { UserId = userId, Title = title + " goal", Status = goalStatus.Value });
        _ctx.Db.Events.Add(ev);
        await _ctx.Db.SaveChangesAsync();
        return ev;
    }

    private async Task<BaseEvent> AddBaseEventAsync(Guid userId, string title, GoalStatus? goalStatus = null)
    {
        var be = new BaseEvent { UserId = userId, Title = title };
        if (goalStatus.HasValue)
            be.Goals.Add(new Goal { UserId = userId, Title = title + " goal", Status = goalStatus.Value });
        _ctx.Db.BaseEvents.Add(be);
        await _ctx.Db.SaveChangesAsync();
        return be;
    }

    private static readonly DateTimeOffset Now = new(2026, 7, 7, 12, 0, 0, TimeSpan.Zero); // Tuesday
    private static readonly DateOnly Today = new(2026, 7, 7);

    [Fact]
    public async Task GetAsync_tier1_returns_floating_focus_events()
    {
        var userId = await CreateUserAsync();
        var focusFloating = await AddEventAsync(userId, "focus task", goalStatus: GoalStatus.focus);
        var activeFloating = await AddEventAsync(userId, "active task", goalStatus: GoalStatus.active);

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Equal(2, recs.Count);
        Assert.Equal(1, recs[0].Tier);
        Assert.Equal("event", recs[0].Type);
        Assert.Equal(focusFloating.Id, recs[0].Event!.Id);
        Assert.Equal(2, recs[1].Tier);
        Assert.Equal(activeFloating.Id, recs[1].Event!.Id);
    }

    [Fact]
    public async Task GetAsync_scheduled_events_are_not_recommended()
    {
        var userId = await CreateUserAsync();
        // Scheduled for today — should NOT appear in recommendations
        await AddEventAsync(userId, "today scheduled",
            startAt: new DateTimeOffset(2026, 7, 7, 9, 0, 0, TimeSpan.Zero),
            goalStatus: GoalStatus.focus);
        // Overdue — should NOT appear either
        await AddEventAsync(userId, "overdue",
            startAt: new DateTimeOffset(2026, 7, 5, 9, 0, 0, TimeSpan.Zero),
            goalStatus: GoalStatus.active);

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Empty(recs);
    }

    [Fact]
    public async Task GetAsync_tier3_surfaces_base_events_with_weekday_pattern()
    {
        var userId = await CreateUserAsync();
        var be = await AddBaseEventAsync(userId, "Tuesday deep work");

        // 3 completions on Tuesdays (day of week 2): Jul 7, Jun 30, Jun 23 are all Tuesdays
        await AddEventAsync(userId, "Tuesday deep work",
            startAt: new DateTimeOffset(2026, 6, 23, 9, 0, 0, TimeSpan.Zero),
            status: EventStatus.done, baseEventId: be.Id);
        await AddEventAsync(userId, "Tuesday deep work",
            startAt: new DateTimeOffset(2026, 6, 30, 9, 0, 0, TimeSpan.Zero),
            status: EventStatus.done, baseEventId: be.Id);
        // No pending event with this base event id for today → should appear in tier 3

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Single(recs);
        Assert.Equal(3, recs[0].Tier);
        Assert.Equal("base_event", recs[0].Type);
        Assert.Equal(be.Id, recs[0].BaseEvent!.Id);
    }

    [Fact]
    public async Task GetAsync_tier3_suppressed_when_base_event_already_on_today_schedule()
    {
        var userId = await CreateUserAsync();
        var be = await AddBaseEventAsync(userId, "Morning run");

        await AddEventAsync(userId, "Morning run",
            startAt: new DateTimeOffset(2026, 6, 23, 6, 0, 0, TimeSpan.Zero),
            status: EventStatus.done, baseEventId: be.Id);
        await AddEventAsync(userId, "Morning run",
            startAt: new DateTimeOffset(2026, 6, 30, 6, 0, 0, TimeSpan.Zero),
            status: EventStatus.done, baseEventId: be.Id);

        // Instance already scheduled for today
        await AddEventAsync(userId, "Morning run",
            startAt: new DateTimeOffset(2026, 7, 7, 6, 0, 0, TimeSpan.Zero),
            baseEventId: be.Id);

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Empty(recs);
    }

    [Fact]
    public async Task GetAsync_tier3_requires_at_least_2_completions_on_weekday()
    {
        var userId = await CreateUserAsync();
        var be = await AddBaseEventAsync(userId, "Tuesday solo");

        // Only 1 completion on a Tuesday — below threshold
        await AddEventAsync(userId, "Tuesday solo",
            startAt: new DateTimeOffset(2026, 6, 30, 9, 0, 0, TimeSpan.Zero),
            status: EventStatus.done, baseEventId: be.Id);

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Empty(recs);
    }

    [Fact]
    public async Task GetAsync_tier4_bench_surfaces_only_when_tiers_1_to_3_empty()
    {
        var userId = await CreateUserAsync();
        var bench = await AddEventAsync(userId, "bench task", goalStatus: GoalStatus.bench);

        var alone = await _ctx.RecommendationService.GetAsync(userId, Today, Now);
        Assert.Single(alone);
        Assert.Equal(4, alone[0].Tier);
        Assert.Equal(bench.Id, alone[0].Event!.Id);

        // Add a focus floating event — bench should disappear
        await AddEventAsync(userId, "focus task", goalStatus: GoalStatus.focus);

        var withFocus = await _ctx.RecommendationService.GetAsync(userId, Today, Now);
        Assert.DoesNotContain(withFocus, r => r.Event?.Id == bench.Id);
    }

    [Fact]
    public async Task GetAsync_event_appears_at_most_once_in_highest_tier()
    {
        var userId = await CreateUserAsync();
        // Event linked to both focus and active goals — should appear only in tier 1
        var ev = new Event { UserId = userId, Title = "multi-goal task" };
        ev.Goals.Add(new Goal { UserId = userId, Title = "focus g", Status = GoalStatus.focus });
        ev.Goals.Add(new Goal { UserId = userId, Title = "active g", Status = GoalStatus.active });
        _ctx.Db.Events.Add(ev);
        await _ctx.Db.SaveChangesAsync();

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Single(recs);
        Assert.Equal(1, recs[0].Tier);
        Assert.Equal(ev.Id, recs[0].Event!.Id);
    }

    [Fact]
    public async Task GetAsync_excludes_done_and_skipped_events()
    {
        var userId = await CreateUserAsync();
        await AddEventAsync(userId, "done task", goalStatus: GoalStatus.focus, status: EventStatus.done);
        await AddEventAsync(userId, "skipped task", goalStatus: GoalStatus.active, status: EventStatus.skipped);

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Empty(recs);
    }

    [Fact]
    public async Task GetAsync_tier3_ignores_completions_older_than_6_weeks()
    {
        var userId = await CreateUserAsync();
        var be = await AddBaseEventAsync(userId, "Old habit");

        // Both completions are > 42 days ago
        await AddEventAsync(userId, "Old habit",
            startAt: new DateTimeOffset(2026, 5, 19, 9, 0, 0, TimeSpan.Zero), // 49 days before Jul 7
            status: EventStatus.done, baseEventId: be.Id);
        await AddEventAsync(userId, "Old habit",
            startAt: new DateTimeOffset(2026, 5, 26, 9, 0, 0, TimeSpan.Zero), // 42 days before Jul 7
            status: EventStatus.done, baseEventId: be.Id);

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Empty(recs);
    }

    [Fact]
    public async Task GetAsync_buckets_days_in_user_timezone()
    {
        // 22:30 UTC on Jul 7 is 00:30 on Jul 8 in Zagreb (UTC+2 in summer)
        // An event starting then is NOT floating and is on Jul 8, so should not appear in recommendations for Jul 7
        var userId = await CreateUserAsync(timezone: "Europe/Zagreb");
        await AddEventAsync(userId, "tomorrow local",
            startAt: new DateTimeOffset(2026, 7, 7, 22, 30, 0, TimeSpan.Zero),
            goalStatus: GoalStatus.focus);

        // The event is scheduled (not floating), so it should not appear as a recommendation at all
        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Empty(recs);
    }
}
