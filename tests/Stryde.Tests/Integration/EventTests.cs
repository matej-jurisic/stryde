using System.Net;
using System.Net.Http.Json;
using Xunit;

namespace Stryde.Tests.Integration;

public class OccurrenceTests : IDisposable
{
    private readonly StrydeApiFactory _factory = new();
    private readonly HttpClient _client;

    public OccurrenceTests()
    {
        _client = _factory.CreateClient();
    }

    private async Task<Guid> CreateActivityAsync(string title = "Test Activity")
    {
        var res = await _client.PostAsJsonAsync("/api/activities", new { title });
        res.EnsureSuccessStatusCode();
        var activity = await res.ReadAsync<ActivityDto>();
        return activity.Id;
    }

    [Fact]
    public async Task CreateOccurrence_ReturnsDto()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);
        var activityId = await CreateActivityAsync();

        var res = await _client.PostAsJsonAsync("/api/occurrences", new { activityId, title = "Test Event" });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);

        var occ = await res.ReadAsync<OccurrenceDto>();
        Assert.Equal("Test Event", occ.EffectiveTitle);
        Assert.Equal("pending", occ.Status);
        Assert.Null(occ.StartAt);
    }

    [Fact]
    public async Task CreateFloatingOccurrence_AppearsInFloatingFilter()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);
        var activityId = await CreateActivityAsync();

        await _client.PostAsJsonAsync("/api/occurrences", new { activityId, title = "Floating Event" });
        await _client.PostAsJsonAsync("/api/occurrences", new
        {
            activityId,
            title = "Scheduled Event",
            startAt = DateTimeOffset.UtcNow.AddHours(1),
        });

        var res = await _client.GetAsync("/api/occurrences?floating=true");
        var occurrences = await res.ReadAsync<List<OccurrenceDto>>();
        Assert.All(occurrences, o => Assert.Null(o.StartAt));
    }

    [Fact]
    public async Task SetOccurrenceStatus_Done()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);
        var activityId = await CreateActivityAsync();

        var res = await _client.PostAsJsonAsync("/api/occurrences", new { activityId, title = "Task to complete" });
        var occ = await res.ReadAsync<OccurrenceDto>();

        var statusRes = await _client.PostAsJsonAsync($"/api/occurrences/{occ.Id}/status", new { status = "done" });
        Assert.Equal(HttpStatusCode.OK, statusRes.StatusCode);
        var updated = await statusRes.ReadAsync<OccurrenceDto>();
        Assert.Equal("done", updated.Status);
    }

    [Fact]
    public async Task CreateWindowedOccurrence_ExcludedFromFloatingFilter()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);
        var activityId = await CreateActivityAsync();

        var winStart = DateTimeOffset.UtcNow.AddHours(1);
        var winEnd = winStart.AddHours(8);
        await _client.PostAsJsonAsync("/api/occurrences", new
        {
            activityId,
            title = "Windowed task",
            windowStart = winStart,
            windowEnd = winEnd,
            windowDurationMinutes = 60,
        });
        await _client.PostAsJsonAsync("/api/occurrences", new { activityId, title = "Floating task" });

        var res = await _client.GetAsync("/api/occurrences?floating=true");
        var occurrences = await res.ReadAsync<List<OccurrenceDto>>();

        Assert.Single(occurrences);
        Assert.Equal("Floating task", occurrences[0].EffectiveTitle);
    }

    [Fact]
    public async Task CreateWindowedOccurrence_IncludedInCalendarRange()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);
        var activityId = await CreateActivityAsync();

        var winStart = new DateTimeOffset(2026, 8, 1, 9, 0, 0, TimeSpan.Zero);
        var winEnd = new DateTimeOffset(2026, 8, 1, 17, 0, 0, TimeSpan.Zero);
        await _client.PostAsJsonAsync("/api/occurrences", new
        {
            activityId,
            title = "August task",
            windowStart = winStart,
            windowEnd = winEnd,
            windowDurationMinutes = 120,
        });

        var startFrom = Uri.EscapeDataString("2026-08-01T00:00:00+00:00");
        var endBefore = Uri.EscapeDataString("2026-08-02T00:00:00+00:00");
        var res = await _client.GetAsync($"/api/occurrences?startFrom={startFrom}&endBefore={endBefore}");
        var occurrences = await res.ReadAsync<List<OccurrenceDto>>();

        Assert.Single(occurrences);
        Assert.Equal("August task", occurrences[0].EffectiveTitle);
    }

    [Fact]
    public async Task CreateWindowedOccurrence_CombinedWithStartAt_Returns400()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);
        var activityId = await CreateActivityAsync();

        var res = await _client.PostAsJsonAsync("/api/occurrences", new
        {
            activityId,
            title = "Conflicted",
            startAt = DateTimeOffset.UtcNow.AddHours(1),
            windowStart = DateTimeOffset.UtcNow.AddHours(2),
            windowEnd = DateTimeOffset.UtcNow.AddHours(10),
            windowDurationMinutes = 60,
        });

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    // --- Re-pointing an occurrence at another activity ---

    [Fact]
    public async Task UpdateOccurrence_MovesItToAnotherActivity()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);
        var from = await CreateActivityAsync("Commute");
        var to = await CreateActivityAsync("Commute home");

        var occ = await (await _client.PostAsJsonAsync("/api/occurrences", new { activityId = from }))
            .ReadAsync<OccurrenceDto>();

        var res = await _client.PutAsJsonAsync($"/api/occurrences/{occ.Id}", new
        {
            activityId = to,
            isAllDay = false,
            isPlanned = false,
        });

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var updated = await res.ReadAsync<OccurrenceDto>();
        Assert.Equal(to, updated.ActivityId);
        Assert.Equal("Commute home", updated.EffectiveTitle);
    }

    [Fact]
    public async Task UpdateOccurrence_WithoutActivityId_LeavesTheLinkAlone()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);
        var activityId = await CreateActivityAsync();

        var occ = await (await _client.PostAsJsonAsync("/api/occurrences", new { activityId }))
            .ReadAsync<OccurrenceDto>();

        // Omitting the field is how every existing caller updates an occurrence
        var res = await _client.PutAsJsonAsync($"/api/occurrences/{occ.Id}", new
        {
            title = "Renamed",
            isAllDay = false,
            isPlanned = false,
        });

        var updated = await res.ReadAsync<OccurrenceDto>();
        Assert.Equal(activityId, updated.ActivityId);
        Assert.Equal("Renamed", updated.EffectiveTitle);
    }

    [Fact]
    public async Task UpdateOccurrence_ToAnUnknownActivity_Returns404()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);
        var activityId = await CreateActivityAsync();

        var occ = await (await _client.PostAsJsonAsync("/api/occurrences", new { activityId }))
            .ReadAsync<OccurrenceDto>();

        var res = await _client.PutAsJsonAsync($"/api/occurrences/{occ.Id}", new
        {
            activityId = Guid.NewGuid(),
            isAllDay = false,
            isPlanned = false,
        });

        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }

    [Fact]
    public async Task UpdateOccurrence_CannotMoveAnEventToAnActivity()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);
        var activityId = await CreateActivityAsync();

        // An event's activity is a backing row it owns 1:1, not a link the user chose
        var evt = await (await _client.PostAsJsonAsync("/api/occurrences/event", new { title = "Theater" }))
            .ReadAsync<OccurrenceDto>();

        var res = await _client.PutAsJsonAsync($"/api/occurrences/{evt.Id}", new
        {
            activityId,
            isAllDay = false,
            isPlanned = false,
        });

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task UpdateOccurrence_CannotMoveAnOccurrenceOntoAnEvent()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);
        var activityId = await CreateActivityAsync();

        var evt = await (await _client.PostAsJsonAsync("/api/occurrences/event", new { title = "Theater" }))
            .ReadAsync<OccurrenceDto>();
        var occ = await (await _client.PostAsJsonAsync("/api/occurrences", new { activityId }))
            .ReadAsync<OccurrenceDto>();

        // Would give the backing activity two occurrences, and deleting either would take both
        var res = await _client.PutAsJsonAsync($"/api/occurrences/{occ.Id}", new
        {
            activityId = evt.ActivityId,
            isAllDay = false,
            isPlanned = false,
        });

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task CreateOccurrence_OnAnEventActivity_Returns400()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);

        var evt = await (await _client.PostAsJsonAsync("/api/occurrences/event", new { title = "Theater" }))
            .ReadAsync<OccurrenceDto>();

        var res = await _client.PostAsJsonAsync("/api/occurrences", new { activityId = evt.ActivityId });

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    public void Dispose() => _factory.Dispose();

    private sealed record ActivityDto(Guid Id);
    private sealed record OccurrenceDto(Guid Id, Guid ActivityId, string? Title, string EffectiveTitle, string Status, DateTimeOffset? StartAt, DateTimeOffset? WindowStart, DateTimeOffset? WindowEnd, int? WindowDurationMinutes);
}
