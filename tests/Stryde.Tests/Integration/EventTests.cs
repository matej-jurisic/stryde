using System.Net;
using System.Net.Http.Json;
using Xunit;

namespace Stryde.Tests.Integration;

public class EventTests : IDisposable
{
    private readonly StrydeApiFactory _factory = new();
    private readonly HttpClient _client;

    public EventTests()
    {
        _client = _factory.CreateClient();
    }

    [Fact]
    public async Task CreateEvent_ReturnsDto()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);

        var res = await _client.PostAsJsonAsync("/api/events", new { title = "Test Event" });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);

        var ev = await res.ReadAsync<EventDto>();
        Assert.Equal("Test Event", ev.Title);
        Assert.Equal("pending", ev.Status);
        Assert.Null(ev.StartAt);
    }

    [Fact]
    public async Task CreateFloatingEvent_AppearsInFloatingFilter()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);

        await _client.PostAsJsonAsync("/api/events", new { title = "Floating Event" });
        await _client.PostAsJsonAsync("/api/events", new
        {
            title = "Scheduled Event",
            startAt = DateTimeOffset.UtcNow.AddHours(1)
        });

        var res = await _client.GetAsync("/api/events?floating=true");
        var events = await res.ReadAsync<List<EventDto>>();
        Assert.All(events, e => Assert.Null(e.StartAt));
    }

    [Fact]
    public async Task SetEventStatus_Done()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);

        var res = await _client.PostAsJsonAsync("/api/events", new { title = "Task to complete" });
        var ev = await res.ReadAsync<EventDto>();

        var statusRes = await _client.PostAsJsonAsync($"/api/events/{ev.Id}/status", new { status = "done" });
        Assert.Equal(HttpStatusCode.OK, statusRes.StatusCode);
        var updated = await statusRes.ReadAsync<EventDto>();
        Assert.Equal("done", updated.Status);
    }

    public void Dispose() => _factory.Dispose();

    private sealed record EventDto(Guid Id, string Title, string Status, DateTimeOffset? StartAt);
}
