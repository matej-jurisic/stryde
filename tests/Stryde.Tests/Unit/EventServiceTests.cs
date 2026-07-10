using Stryde.Core.Common;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;

namespace Stryde.Tests.Unit;

public class OccurrenceServiceTests : IDisposable
{
    private readonly TestContext _ctx = new();

    public void Dispose() => _ctx.Dispose();

    private async Task<(Guid userId, Guid activityId)> CreateUserAndActivityAsync()
    {
        var user = new User
        {
            Username = "u" + Guid.NewGuid().ToString("N")[..8],
            PasswordHash = "x",
            Timezone = "UTC",
        };
        _ctx.Db.Users.Add(user);
        var activity = new Activity { UserId = user.Id, Title = "Test activity" };
        _ctx.Db.Activities.Add(activity);
        await _ctx.Db.SaveChangesAsync();
        return (user.Id, activity.Id);
    }

    private static readonly DateTimeOffset WinStart = new(2026, 7, 10, 9, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset WinEnd = new(2026, 7, 10, 17, 0, 0, TimeSpan.Zero); // 8-hour window

    private static CreateOccurrenceRequest Req(
        Guid activityId,
        DateTimeOffset? startAt = null,
        DateTimeOffset? windowStart = null,
        DateTimeOffset? windowEnd = null,
        int? windowDurationMinutes = null) =>
        new(activityId, null, startAt, null, false, windowStart, windowEnd, windowDurationMinutes);

    [Fact]
    public async Task CreateAsync_windowed_occurrence_succeeds()
    {
        var (userId, activityId) = await CreateUserAndActivityAsync();

        var result = await _ctx.OccurrenceService.CreateAsync(userId, Req(activityId, windowStart: WinStart, windowEnd: WinEnd, windowDurationMinutes: 60));

        Assert.True(result.IsSuccess);
        Assert.Equal(WinStart, result.Value!.WindowStart);
        Assert.Equal(WinEnd, result.Value.WindowEnd);
        Assert.Equal(60, result.Value.WindowDurationMinutes);
        Assert.Null(result.Value.StartAt);
    }

    [Fact]
    public async Task CreateAsync_window_and_startAt_returns_validation()
    {
        var (userId, activityId) = await CreateUserAndActivityAsync();
        var startAt = new DateTimeOffset(2026, 7, 10, 8, 0, 0, TimeSpan.Zero);

        var result = await _ctx.OccurrenceService.CreateAsync(userId, Req(activityId, startAt: startAt, windowStart: WinStart, windowEnd: WinEnd, windowDurationMinutes: 60));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
    }

    [Fact]
    public async Task CreateAsync_partial_window_fields_returns_validation()
    {
        var (userId, activityId) = await CreateUserAndActivityAsync();

        // windowStart + windowEnd provided but duration omitted
        var result = await _ctx.OccurrenceService.CreateAsync(userId, Req(activityId, windowStart: WinStart, windowEnd: WinEnd));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
    }

    [Fact]
    public async Task CreateAsync_window_end_before_start_returns_validation()
    {
        var (userId, activityId) = await CreateUserAndActivityAsync();

        var result = await _ctx.OccurrenceService.CreateAsync(userId, Req(activityId, windowStart: WinEnd, windowEnd: WinStart, windowDurationMinutes: 60));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
    }

    [Fact]
    public async Task CreateAsync_duration_exceeds_window_returns_validation()
    {
        var (userId, activityId) = await CreateUserAndActivityAsync();

        // Window is 8 hours (480 min); duration 600 min > window
        var result = await _ctx.OccurrenceService.CreateAsync(userId, Req(activityId, windowStart: WinStart, windowEnd: WinEnd, windowDurationMinutes: 600));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
    }

    [Fact]
    public async Task ListAsync_floatingOnly_excludes_windowed_occurrences()
    {
        var (userId, activityId) = await CreateUserAndActivityAsync();

        await _ctx.OccurrenceService.CreateAsync(userId, Req(activityId));
        await _ctx.OccurrenceService.CreateAsync(userId, Req(activityId, windowStart: WinStart, windowEnd: WinEnd, windowDurationMinutes: 60));

        var floating = await _ctx.OccurrenceService.ListAsync(userId, floatingOnly: true);

        Assert.Single(floating);
        Assert.Equal("Test activity", floating[0].EffectiveTitle);
    }
}
