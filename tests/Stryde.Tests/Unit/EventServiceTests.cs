using Stryde.Core.Common;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;

namespace Stryde.Tests.Unit;

public class EventServiceTests : IDisposable
{
    private readonly TestContext _ctx = new();

    public void Dispose() => _ctx.Dispose();

    private async Task<Guid> CreateUserAsync()
    {
        var user = new User
        {
            Username = "u" + Guid.NewGuid().ToString("N")[..8],
            PasswordHash = "x",
            Timezone = "UTC",
        };
        _ctx.Db.Users.Add(user);
        await _ctx.Db.SaveChangesAsync();
        return user.Id;
    }

    private static readonly DateTimeOffset WinStart = new(2026, 7, 10, 9, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset WinEnd = new(2026, 7, 10, 17, 0, 0, TimeSpan.Zero); // 8-hour window

    private static CreateEventRequest Req(
        string title = "Task",
        DateTimeOffset? startAt = null,
        DateTimeOffset? windowStart = null,
        DateTimeOffset? windowEnd = null,
        int? windowDurationMinutes = null) =>
        new(title, startAt, null, false, windowStart, windowEnd, windowDurationMinutes, null, null, null);

    [Fact]
    public async Task CreateAsync_windowed_event_succeeds()
    {
        var userId = await CreateUserAsync();

        var result = await _ctx.EventService.CreateAsync(userId, Req(windowStart: WinStart, windowEnd: WinEnd, windowDurationMinutes: 60));

        Assert.True(result.IsSuccess);
        Assert.Equal(WinStart, result.Value!.WindowStart);
        Assert.Equal(WinEnd, result.Value.WindowEnd);
        Assert.Equal(60, result.Value.WindowDurationMinutes);
        Assert.Null(result.Value.StartAt);
    }

    [Fact]
    public async Task CreateAsync_window_and_startAt_returns_validation()
    {
        var userId = await CreateUserAsync();
        var startAt = new DateTimeOffset(2026, 7, 10, 8, 0, 0, TimeSpan.Zero);

        var result = await _ctx.EventService.CreateAsync(userId, Req(startAt: startAt, windowStart: WinStart, windowEnd: WinEnd, windowDurationMinutes: 60));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
    }

    [Fact]
    public async Task CreateAsync_partial_window_fields_returns_validation()
    {
        var userId = await CreateUserAsync();

        // windowStart + windowEnd provided but duration omitted
        var result = await _ctx.EventService.CreateAsync(userId, Req(windowStart: WinStart, windowEnd: WinEnd));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
    }

    [Fact]
    public async Task CreateAsync_window_end_before_start_returns_validation()
    {
        var userId = await CreateUserAsync();

        var result = await _ctx.EventService.CreateAsync(userId, Req(windowStart: WinEnd, windowEnd: WinStart, windowDurationMinutes: 60));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
    }

    [Fact]
    public async Task CreateAsync_duration_exceeds_window_returns_validation()
    {
        var userId = await CreateUserAsync();

        // Window is 8 hours (480 min); duration 600 min > window
        var result = await _ctx.EventService.CreateAsync(userId, Req(windowStart: WinStart, windowEnd: WinEnd, windowDurationMinutes: 600));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
    }

    [Fact]
    public async Task ListAsync_floatingOnly_excludes_windowed_events()
    {
        var userId = await CreateUserAsync();

        // Create a floating event and a windowed event
        await _ctx.EventService.CreateAsync(userId, Req("Floating task"));
        await _ctx.EventService.CreateAsync(userId, Req("Windowed task", windowStart: WinStart, windowEnd: WinEnd, windowDurationMinutes: 60));

        var floating = await _ctx.EventService.ListAsync(userId, floatingOnly: true);

        Assert.Single(floating);
        Assert.Equal("Floating task", floating[0].Title);
    }
}
