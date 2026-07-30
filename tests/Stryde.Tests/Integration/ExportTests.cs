using System.Net;
using System.Net.Http.Json;
using Xunit;

namespace Stryde.Tests.Integration;

public class ExportTests : IDisposable
{
    private readonly StrydeApiFactory _factory = new();
    private readonly HttpClient _client;

    public ExportTests()
    {
        _client = _factory.CreateClient();
    }

    [Fact]
    public async Task Export_RequiresAuth()
    {
        var res = await _client.GetAsync("/api/export");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Export_RendersEverythingAsMarkdown()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);

        var catRes = await _client.PostAsJsonAsync("/api/categories", new { name = "Health", color = "#22c55e" });
        var cat = await catRes.ReadAsync<IdDto>();

        var goalRes = await _client.PostAsJsonAsync("/api/goals", new { title = "Learn carving" });
        var goal = await goalRes.ReadAsync<IdDto>();
        await _client.PostAsJsonAsync($"/api/goals/{goal.Id}/checkpoints", new { title = "First spoon", size = "normal" });

        var typeRes = await _client.PostAsJsonAsync("/api/activity-types", new
        {
            name = "Deep work",
            icon = "Brain",
            windowStart = "09:00",
            windowEnd = "17:00",
            minBlockMinutes = 90,
            maxPerDay = 2,
            cadencePriorDays = 2.5,
            minDueFraction = 0.5,
        });
        var type = await typeRes.ReadAsync<IdDto>();

        var stateRes = await _client.PostAsJsonAsync("/api/states", new { name = "Location" });
        var state = await stateRes.ReadAsync<StateDto>();
        await _client.PostAsJsonAsync($"/api/states/{state.Id}/values", new { name = "Home", isDefault = true });
        var workRes = await _client.PostAsJsonAsync($"/api/states/{state.Id}/values", new { name = "Work" });
        var work = (await workRes.ReadAsync<StateDto>()).Values.First(v => v.Name == "Work");

        var actRes = await _client.PostAsJsonAsync("/api/activities", new
        {
            title = "Practice",
            categoryId = cat.Id,
            goalId = goal.Id,
            activityTypeId = type.Id,
            setsStateValues = new[] { new { stateValueId = work.Id, durationMinutes = 180 } },
        });
        var act = await actRes.ReadAsync<IdDto>();
        await _client.PostAsJsonAsync($"/api/activities/{act.Id}/subtasks", new { title = "Sharpen knife" });
        await _client.PostAsJsonAsync("/api/occurrences", new
        {
            activityId = act.Id,
            startAt = "2026-07-28T08:00:00Z",
            endAt = "2026-07-28T09:30:00Z",
        });

        var res = await _client.GetAsync("/api/export");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("text/markdown", res.Content.Headers.ContentType?.MediaType);

        var md = await res.Content.ReadAsStringAsync();

        Assert.Contains("# Stryde export: testuser", md);
        Assert.Contains("## What the words mean", md);
        Assert.Contains("## Settings", md);

        // Activity types: the numbers spelled out, never raw field names.
        Assert.Contains("### Deep work", md);
        Assert.Contains("between 09:00 and 17:00", md);
        Assert.Contains("90 minutes", md);
        Assert.Contains("at most 2", md);
        Assert.Contains("about every 2.5 days", md);
        Assert.Contains("halfway to due", md);

        // States, from both directions.
        Assert.Contains("### Location", md);
        Assert.Contains("**Home** (default)", md);
        Assert.Contains("Practice sets it to Location = Work, for 3 hours", md);

        Assert.Contains("### Health", md);
        Assert.Contains("### Learn carving", md);
        Assert.Contains("[ ] First spoon - normal", md);
        Assert.Contains("#### Practice", md);
        Assert.Contains("Sharpen knife", md);

        // History: local times, grouped by day.
        Assert.Contains("2026-07-28, Tuesday", md);
        Assert.Contains("08:00-09:30", md);
        Assert.Contains("pending", md);

        Assert.DoesNotContain(act.Id.ToString(), md);
    }

    [Fact]
    public async Task Export_EmptyAccount_StillRenders()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);

        var res = await _client.GetAsync("/api/export");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        var md = await res.Content.ReadAsStringAsync();
        Assert.Contains("nothing scheduled yet", md);
        Assert.Contains("## History", md);
    }

    public void Dispose() => _factory.Dispose();

    private sealed record IdDto(Guid Id);
    private sealed record StateDto(Guid Id, string Name, List<StateValueDto> Values);
    private sealed record StateValueDto(Guid Id, string Name, bool IsDefault);
}
