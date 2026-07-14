using Stryde.Core.Entities;
using Stryde.Core.Enums;

namespace Stryde.Tests.Unit;

public class InsightsServiceTests : IDisposable
{
    private readonly TestContext _ctx = new();

    public void Dispose() => _ctx.Dispose();

    private static readonly DateTimeOffset Now = new(2026, 7, 7, 12, 0, 0, TimeSpan.Zero); // Tuesday

    private static DateTimeOffset At(int day, int hour, int minute = 0) =>
        new(2026, 7, day, hour, minute, 0, TimeSpan.Zero);

    private async Task<Guid> CreateUserAsync(string timezone = "UTC")
    {
        var user = new User
        {
            Username = "u" + Guid.NewGuid().ToString("N")[..8],
            PasswordHash = "x",
            Timezone = timezone,
        };
        _ctx.Db.Users.Add(user);
        await _ctx.Db.SaveChangesAsync();
        return user.Id;
    }

    private async Task<Activity> AddActivityAsync(Guid userId, string title, Guid? categoryId = null)
    {
        var activity = new Activity { UserId = userId, Title = title, CategoryId = categoryId };
        _ctx.Db.Activities.Add(activity);
        await _ctx.Db.SaveChangesAsync();
        return activity;
    }

    private async Task<Category> AddCategoryAsync(Guid userId, string name, string color = "#8499B1")
    {
        var category = new Category { UserId = userId, Name = name, Color = color };
        _ctx.Db.Categories.Add(category);
        await _ctx.Db.SaveChangesAsync();
        return category;
    }

    private async Task AddOccurrenceAsync(
        Guid userId, Activity activity, DateTimeOffset? startAt, EventStatus status = EventStatus.done)
    {
        _ctx.Db.Occurrences.Add(new Occurrence
        {
            UserId = userId,
            ActivityId = activity.Id,
            StartAt = startAt,
            Status = status,
        });
        await _ctx.Db.SaveChangesAsync();
    }

    [Fact]
    public async Task GetAsync_counts_done_occurrences_per_window()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "task");
        await AddOccurrenceAsync(userId, activity, At(7, 9));   // today
        await AddOccurrenceAsync(userId, activity, At(7, 15));  // today
        await AddOccurrenceAsync(userId, activity, At(3, 9));   // this week
        await AddOccurrenceAsync(userId, activity, new DateTimeOffset(2026, 6, 15, 9, 0, 0, TimeSpan.Zero)); // last 30 days
        await AddOccurrenceAsync(userId, activity, new DateTimeOffset(2026, 5, 1, 9, 0, 0, TimeSpan.Zero));  // outside all windows

        var insights = await _ctx.InsightsService.GetAsync(userId, Now);

        Assert.Equal(2, insights.DoneToday);
        Assert.Equal(3, insights.DoneThisWeek);
        Assert.Equal(4, insights.DoneLast30Days);
    }

    [Fact]
    public async Task GetAsync_pending_skipped_and_floating_do_not_count()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "task");
        await AddOccurrenceAsync(userId, activity, At(7, 9), EventStatus.pending);
        await AddOccurrenceAsync(userId, activity, At(7, 10), EventStatus.skipped);
        await AddOccurrenceAsync(userId, activity, startAt: null); // floating done

        var insights = await _ctx.InsightsService.GetAsync(userId, Now);

        Assert.Equal(0, insights.DoneToday);
        Assert.Equal(0, insights.DoneLast30Days);
    }

    [Fact]
    public async Task GetAsync_days_covers_14_days_ending_today()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "task");
        await AddOccurrenceAsync(userId, activity, At(7, 9));
        await AddOccurrenceAsync(userId, activity, At(5, 9));

        var insights = await _ctx.InsightsService.GetAsync(userId, Now);

        Assert.Equal(14, insights.Days.Count);
        Assert.Equal(new DateOnly(2026, 6, 24), insights.Days[0].Day);
        Assert.Equal(new DateOnly(2026, 7, 7), insights.Days[^1].Day);
        Assert.Equal(1, insights.Days[^1].Done);
        Assert.Equal(1, insights.Days[^3].Done);
        Assert.Equal(0, insights.Days[^2].Done);
    }

    [Fact]
    public async Task GetAsync_streak_counts_consecutive_days()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "task");
        await AddOccurrenceAsync(userId, activity, At(7, 9));
        await AddOccurrenceAsync(userId, activity, At(6, 9));
        await AddOccurrenceAsync(userId, activity, At(5, 9));
        await AddOccurrenceAsync(userId, activity, At(3, 9)); // gap on the 4th breaks it

        var insights = await _ctx.InsightsService.GetAsync(userId, Now);

        Assert.Equal(3, insights.CurrentStreakDays);
    }

    [Fact]
    public async Task GetAsync_streak_survives_a_day_with_no_completion_yet()
    {
        var userId = await CreateUserAsync();
        var activity = await AddActivityAsync(userId, "task");
        await AddOccurrenceAsync(userId, activity, At(6, 9));
        await AddOccurrenceAsync(userId, activity, At(5, 9));

        var insights = await _ctx.InsightsService.GetAsync(userId, Now);

        Assert.Equal(2, insights.CurrentStreakDays);
    }

    [Fact]
    public async Task GetAsync_categories_group_last_30_days_with_uncategorized_bucket()
    {
        var userId = await CreateUserAsync();
        var health = await AddCategoryAsync(userId, "Health");
        var withCategory = await AddActivityAsync(userId, "run", health.Id);
        var without = await AddActivityAsync(userId, "chores");

        await AddOccurrenceAsync(userId, withCategory, At(7, 9));
        await AddOccurrenceAsync(userId, withCategory, At(6, 9));
        await AddOccurrenceAsync(userId, without, At(7, 10));
        await AddOccurrenceAsync(userId, withCategory, new DateTimeOffset(2026, 5, 1, 9, 0, 0, TimeSpan.Zero)); // outside window

        var insights = await _ctx.InsightsService.GetAsync(userId, Now);

        Assert.Equal(2, insights.Categories.Count);
        Assert.Equal(health.Id, insights.Categories[0].CategoryId);
        Assert.Equal("Health", insights.Categories[0].Name);
        Assert.Equal(2, insights.Categories[0].Done);
        Assert.Null(insights.Categories[1].CategoryId);
        Assert.Equal(1, insights.Categories[1].Done);
    }

    [Fact]
    public async Task GetAsync_day_boundary_buckets_late_night_completion_to_previous_day()
    {
        var userId = await CreateUserAsync();
        _ctx.Db.UserSettings.Add(new UserSettings { UserId = userId, DayBoundaryTime = new TimeOnly(4, 0) });
        await _ctx.Db.SaveChangesAsync();

        var activity = await AddActivityAsync(userId, "night owl");
        // 01:00 on the 7th is before the 04:00 boundary — belongs to the 6th
        await AddOccurrenceAsync(userId, activity, At(7, 1));

        var insights = await _ctx.InsightsService.GetAsync(userId, Now);

        Assert.Equal(0, insights.DoneToday);
        Assert.Equal(1, insights.Days[^2].Done);
    }
}
