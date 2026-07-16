using Stryde.Core.Entities;
using Stryde.Core.Enums;

namespace Stryde.Tests.Unit;

public class InsightsServiceTests : IDisposable
{
    private readonly TestContext _ctx = new();

    public void Dispose() => _ctx.Dispose();

    private static readonly DateTimeOffset Now = new(2026, 7, 7, 12, 0, 0, TimeSpan.Zero);

    private static DateTimeOffset At(int day, int hour, int minute = 0) =>
        new(2026, 7, day, hour, minute, 0, TimeSpan.Zero);

    private async Task<Guid> CreateUserAsync(string timezone = "UTC")
    {
        var user = new User { Username = "u" + Guid.NewGuid().ToString("N")[..8], PasswordHash = "x", Timezone = timezone };
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
        Guid userId, Activity activity,
        DateTimeOffset? startAt, DateTimeOffset? endAt = null,
        EventStatus status = EventStatus.done)
    {
        _ctx.Db.Occurrences.Add(new Occurrence
        {
            UserId = userId,
            ActivityId = activity.Id,
            StartAt = startAt,
            EndAt = endAt,
            Status = status,
        });
        await _ctx.Db.SaveChangesAsync();
    }

    [Fact]
    public async Task GetAsync_sums_elapsed_time_from_start_end()
    {
        var userId = await CreateUserAsync();
        var run = await AddActivityAsync(userId, "run");
        await AddOccurrenceAsync(userId, run, At(7, 9), At(7, 9, 30));  // 30 min
        await AddOccurrenceAsync(userId, run, At(6, 8), At(6, 8, 45));  // 45 min

        var insights = await _ctx.InsightsService.GetAsync(userId, 7, Now);

        Assert.Single(insights.Activities);
        Assert.Equal(75, insights.Activities[0].TimeMinutes);
        Assert.Equal(2, insights.Activities[0].Count);
    }

    [Fact]
    public async Task GetAsync_excludes_occurrences_without_end_time()
    {
        var userId = await CreateUserAsync();
        var run = await AddActivityAsync(userId, "run");
        await AddOccurrenceAsync(userId, run, At(7, 9), At(7, 9, 30));  // 30 min - counted
        await AddOccurrenceAsync(userId, run, At(6, 8));                  // no EndAt - ignored

        var insights = await _ctx.InsightsService.GetAsync(userId, 7, Now);

        Assert.Single(insights.Activities);
        Assert.Equal(30, insights.Activities[0].TimeMinutes);
        Assert.Equal(1, insights.Activities[0].Count);
    }

    [Fact]
    public async Task GetAsync_excludes_occurrences_outside_window()
    {
        var userId = await CreateUserAsync();
        var run = await AddActivityAsync(userId, "run");
        await AddOccurrenceAsync(userId, run, At(7, 9), At(7, 9, 30));                                              // in window
        await AddOccurrenceAsync(userId, run, new DateTimeOffset(2026, 5, 1, 9, 0, 0, TimeSpan.Zero),
            new DateTimeOffset(2026, 5, 1, 9, 30, 0, TimeSpan.Zero));                                               // outside

        var insights = await _ctx.InsightsService.GetAsync(userId, 7, Now);

        Assert.Single(insights.Activities);
        Assert.Equal(30, insights.Activities[0].TimeMinutes);
    }

    [Fact]
    public async Task GetAsync_pending_skipped_and_floating_do_not_count()
    {
        var userId = await CreateUserAsync();
        var run = await AddActivityAsync(userId, "run");
        await AddOccurrenceAsync(userId, run, At(7, 9), At(7, 9, 30), EventStatus.pending);
        await AddOccurrenceAsync(userId, run, At(7, 10), At(7, 10, 30), EventStatus.skipped);
        await AddOccurrenceAsync(userId, run, startAt: null, endAt: null); // floating

        var insights = await _ctx.InsightsService.GetAsync(userId, 7, Now);

        Assert.Empty(insights.Activities);
    }

    [Fact]
    public async Task GetAsync_activities_sorted_by_time_desc()
    {
        var userId = await CreateUserAsync();
        var run = await AddActivityAsync(userId, "run");
        var read = await AddActivityAsync(userId, "read");
        await AddOccurrenceAsync(userId, run, At(7, 9), At(7, 9, 30));   // 30 min
        await AddOccurrenceAsync(userId, read, At(7, 10), At(7, 11, 30)); // 90 min

        var insights = await _ctx.InsightsService.GetAsync(userId, 7, Now);

        Assert.Equal(2, insights.Activities.Count);
        Assert.Equal("read", insights.Activities[0].Title);
        Assert.Equal("run", insights.Activities[1].Title);
    }

    [Fact]
    public async Task GetAsync_largest_gaps_are_untracked_stretches_of_tracked_days()
    {
        var userId = await CreateUserAsync();
        var run = await AddActivityAsync(userId, "run");
        await AddOccurrenceAsync(userId, run, At(7, 9), At(7, 10));
        await AddOccurrenceAsync(userId, run, At(7, 12), At(7, 14));

        var insights = await _ctx.InsightsService.GetAsync(userId, 7, Now);

        // Untracked days contribute no gaps; the tracked day yields 14:00-24:00, 00:00-09:00, 10:00-12:00.
        Assert.Equal(3, insights.LargestGaps.Count);
        Assert.All(insights.LargestGaps, g => Assert.Equal("2026-07-07", g.Day));
        Assert.Equal(("14:00", "00:00", 600), (insights.LargestGaps[0].Start, insights.LargestGaps[0].End, insights.LargestGaps[0].Minutes));
        Assert.Equal(("00:00", "09:00", 540), (insights.LargestGaps[1].Start, insights.LargestGaps[1].End, insights.LargestGaps[1].Minutes));
        Assert.Equal(("10:00", "12:00", 120), (insights.LargestGaps[2].Start, insights.LargestGaps[2].End, insights.LargestGaps[2].Minutes));
    }

    [Fact]
    public async Task GetAsync_overnight_occurrence_covers_the_next_morning()
    {
        var userId = await CreateUserAsync();
        var sleep = await AddActivityAsync(userId, "sleep");
        var run = await AddActivityAsync(userId, "run");
        await AddOccurrenceAsync(userId, sleep, At(6, 23), At(7, 7)); // 23:00 -> 07:00 next day
        await AddOccurrenceAsync(userId, run, At(7, 9), At(7, 10));

        var insights = await _ctx.InsightsService.GetAsync(userId, 7, Now);

        var day7Gaps = insights.LargestGaps.Where(g => g.Day == "2026-07-07").ToList();
        Assert.Equal(2, day7Gaps.Count);
        Assert.Contains(day7Gaps, g => g is { Start: "07:00", End: "09:00", Minutes: 120 });
        Assert.Contains(day7Gaps, g => g is { Start: "10:00", End: "00:00", Minutes: 840 });
    }

    [Fact]
    public async Task GetAsync_unused_blocks_merge_hours_empty_on_most_tracked_days()
    {
        var userId = await CreateUserAsync();
        var busy = await AddActivityAsync(userId, "busy");
        foreach (var day in new[] { 6, 7 })
        {
            await AddOccurrenceAsync(userId, busy, At(day, 0), At(day, 14));
            await AddOccurrenceAsync(userId, busy, At(day, 16), At(day + 1, 0));
        }

        var insights = await _ctx.InsightsService.GetAsync(userId, 7, Now);

        var block = Assert.Single(insights.UnusedBlocks);
        Assert.Equal(("14:00", "16:00", 2, 2), (block.Start, block.End, block.EmptyDays, block.Days));
    }

    [Fact]
    public async Task GetAsync_prev_average_uses_previous_window_only()
    {
        var userId = await CreateUserAsync();
        var run = await AddActivityAsync(userId, "run");
        await AddOccurrenceAsync(userId, run, At(7, 9), At(7, 10));                                                // current window: 60 min
        await AddOccurrenceAsync(userId, run, new DateTimeOffset(2026, 6, 28, 9, 0, 0, TimeSpan.Zero),
            new DateTimeOffset(2026, 6, 28, 12, 0, 0, TimeSpan.Zero));                                             // previous window: 180 min

        var insights = await _ctx.InsightsService.GetAsync(userId, 7, Now);

        Assert.Equal(1440 - 60, insights.AvgUnaccountedMinutesPerDay);
        Assert.Equal(1440 - 180, insights.PrevAvgUnaccountedMinutesPerDay);
    }

    [Fact]
    public async Task GetAsync_prev_average_null_when_previous_window_empty()
    {
        var userId = await CreateUserAsync();
        var run = await AddActivityAsync(userId, "run");
        await AddOccurrenceAsync(userId, run, At(7, 9), At(7, 10));

        var insights = await _ctx.InsightsService.GetAsync(userId, 7, Now);

        Assert.Null(insights.PrevAvgUnaccountedMinutesPerDay);
    }

    [Fact]
    public async Task GetAsync_categories_group_timed_occurrences()
    {
        var userId = await CreateUserAsync();
        var health = await AddCategoryAsync(userId, "Health");
        var withCategory = await AddActivityAsync(userId, "run", health.Id);
        var without = await AddActivityAsync(userId, "chores");

        await AddOccurrenceAsync(userId, withCategory, At(7, 9), At(7, 9, 30));   // 30 min
        await AddOccurrenceAsync(userId, withCategory, At(6, 9), At(6, 9, 45));   // 45 min
        await AddOccurrenceAsync(userId, without, At(7, 10), At(7, 11));           // 60 min

        var insights = await _ctx.InsightsService.GetAsync(userId, 7, Now);

        Assert.Equal(2, insights.Categories.Count);
        // chores (60 min) > health (75 min)... actually 75 > 60, so health first
        Assert.Equal(health.Id, insights.Categories[0].CategoryId);
        Assert.Equal(75, insights.Categories[0].TimeMinutes);
        Assert.Null(insights.Categories[1].CategoryId);
        Assert.Equal(60, insights.Categories[1].TimeMinutes);
    }
}
