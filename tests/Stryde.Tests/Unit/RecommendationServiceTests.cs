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
        GoalStatus? goalStatus = null, EventStatus status = EventStatus.pending)
    {
        var ev = new Event { UserId = userId, Title = title, StartAt = startAt, EndAt = endAt, Status = status };
        if (goalStatus.HasValue)
            ev.Goals.Add(new Goal { UserId = userId, Title = title + " goal", Status = goalStatus.Value });
        _ctx.Db.Events.Add(ev);
        await _ctx.Db.SaveChangesAsync();
        return ev;
    }

    private static readonly DateTimeOffset Now = new(2026, 7, 7, 12, 0, 0, TimeSpan.Zero);
    private static readonly DateOnly Today = new(2026, 7, 7);

    [Fact]
    public async Task GetAsync_orders_by_tier_then_due_date_then_duration()
    {
        var userId = await CreateUserAsync();
        var dueToday = await AddEventAsync(userId, "due today",
            startAt: new DateTimeOffset(2026, 7, 7, 15, 0, 0, TimeSpan.Zero));
        var overdue = await AddEventAsync(userId, "overdue",
            startAt: new DateTimeOffset(2026, 7, 5, 9, 0, 0, TimeSpan.Zero));
        var focusScheduled = await AddEventAsync(userId, "focus later",
            startAt: new DateTimeOffset(2026, 7, 10, 9, 0, 0, TimeSpan.Zero), goalStatus: GoalStatus.focus);
        var activeFloating = await AddEventAsync(userId, "active floating", goalStatus: GoalStatus.active);

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Equal(
            [dueToday.Id, overdue.Id, focusScheduled.Id, activeFloating.Id],
            recs.Select(r => r.Event.Id).ToArray());
        Assert.Equal([1, 2, 3, 6], recs.Select(r => r.Tier).ToArray());
    }

    [Fact]
    public async Task GetAsync_within_tier_sorts_by_due_date_then_shorter_duration()
    {
        var userId = await CreateUserAsync();
        var longEvent = await AddEventAsync(userId, "long",
            startAt: new DateTimeOffset(2026, 7, 7, 9, 0, 0, TimeSpan.Zero),
            endAt: new DateTimeOffset(2026, 7, 7, 15, 0, 0, TimeSpan.Zero));
        var shortEvent = await AddEventAsync(userId, "short",
            startAt: new DateTimeOffset(2026, 7, 7, 14, 0, 0, TimeSpan.Zero),
            endAt: new DateTimeOffset(2026, 7, 7, 15, 0, 0, TimeSpan.Zero));

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        // Both tier 1, both effectively due 15:00; the shorter one fills gaps first
        Assert.Equal([shortEvent.Id, longEvent.Id], recs.Select(r => r.Event.Id).ToArray());
    }

    [Fact]
    public async Task GetAsync_tier7_bench_surfaces_only_when_nothing_else_exists()
    {
        var userId = await CreateUserAsync();
        var bench = await AddEventAsync(userId, "bench floating", goalStatus: GoalStatus.bench);

        var alone = await _ctx.RecommendationService.GetAsync(userId, Today, Now);
        Assert.Single(alone);
        Assert.Equal(7, alone[0].Tier);
        Assert.Equal(bench.Id, alone[0].Event.Id);

        await AddEventAsync(userId, "due today",
            startAt: new DateTimeOffset(2026, 7, 7, 15, 0, 0, TimeSpan.Zero));

        var withDueToday = await _ctx.RecommendationService.GetAsync(userId, Today, Now);
        Assert.DoesNotContain(withDueToday, r => r.Event.Id == bench.Id);
    }

    [Fact]
    public async Task GetAsync_event_due_today_with_passed_end_appears_once_in_tier1()
    {
        var userId = await CreateUserAsync();
        var ev = await AddEventAsync(userId, "ended this morning",
            startAt: new DateTimeOffset(2026, 7, 7, 8, 0, 0, TimeSpan.Zero),
            endAt: new DateTimeOffset(2026, 7, 7, 9, 0, 0, TimeSpan.Zero),
            goalStatus: GoalStatus.focus);

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Single(recs);
        Assert.Equal(1, recs[0].Tier);
        Assert.True(recs[0].Event.IsOverdue);
        Assert.Equal(ev.Id, recs[0].Event.Id);
    }

    [Fact]
    public async Task GetAsync_excludes_done_and_skipped_events()
    {
        var userId = await CreateUserAsync();
        await AddEventAsync(userId, "done",
            startAt: new DateTimeOffset(2026, 7, 7, 15, 0, 0, TimeSpan.Zero), status: EventStatus.done);
        await AddEventAsync(userId, "skipped",
            startAt: new DateTimeOffset(2026, 7, 7, 16, 0, 0, TimeSpan.Zero), status: EventStatus.skipped);

        var recs = await _ctx.RecommendationService.GetAsync(userId, Today, Now);

        Assert.Empty(recs);
    }

    [Fact]
    public async Task GetAsync_buckets_days_in_user_timezone()
    {
        // 22:30 UTC on Jul 7 is 00:30 on Jul 8 in Zagreb (UTC+2 in summer)
        var userId = await CreateUserAsync(timezone: "Europe/Zagreb");
        var ev = await AddEventAsync(userId, "tomorrow local",
            startAt: new DateTimeOffset(2026, 7, 7, 22, 30, 0, TimeSpan.Zero));

        var todayRecs = await _ctx.RecommendationService.GetAsync(userId, new DateOnly(2026, 7, 7), Now);
        Assert.DoesNotContain(todayRecs, r => r.Event.Id == ev.Id);

        var tomorrowRecs = await _ctx.RecommendationService.GetAsync(userId, new DateOnly(2026, 7, 8), Now);
        Assert.Single(tomorrowRecs);
        Assert.Equal(1, tomorrowRecs[0].Tier);
    }

    [Fact]
    public async Task GetAsync_respects_day_boundary_for_today_and_overdue()
    {
        // Day boundary 04:00: at 02:00 UTC on Jul 7 the user's day is still Jul 6
        var userId = await CreateUserAsync(dayBoundary: new TimeOnly(4, 0));
        var ev = await AddEventAsync(userId, "yesterday evening",
            startAt: new DateTimeOffset(2026, 7, 6, 20, 0, 0, TimeSpan.Zero));

        var beforeBoundary = new DateTimeOffset(2026, 7, 7, 2, 0, 0, TimeSpan.Zero);
        var recsBefore = await _ctx.RecommendationService.GetAsync(userId, date: null, nowUtc: beforeBoundary);
        Assert.Single(recsBefore);
        Assert.Equal(1, recsBefore[0].Tier); // still "today", not overdue
        Assert.False(recsBefore[0].Event.IsOverdue);

        var afterBoundary = new DateTimeOffset(2026, 7, 7, 5, 0, 0, TimeSpan.Zero);
        var recsAfter = await _ctx.RecommendationService.GetAsync(userId, date: null, nowUtc: afterBoundary);
        Assert.Single(recsAfter);
        Assert.Equal(2, recsAfter[0].Tier); // day rolled over at 04:00, now overdue
        Assert.True(recsAfter[0].Event.IsOverdue);
    }
}
