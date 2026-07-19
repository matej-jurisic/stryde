using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
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
    public async Task Export_ReturnsAllUserData()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);

        var catRes = await _client.PostAsJsonAsync("/api/categories", new { name = "Health", color = "#22c55e" });
        var cat = await catRes.ReadAsync<IdDto>();

        var goalRes = await _client.PostAsJsonAsync("/api/goals", new { title = "Learn carving" });
        var goal = await goalRes.ReadAsync<IdDto>();
        await _client.PostAsJsonAsync($"/api/goals/{goal.Id}/checkpoints", new { title = "First spoon", size = "normal" });

        var actRes = await _client.PostAsJsonAsync("/api/activities", new { title = "Practice", categoryId = cat.Id, goalId = goal.Id });
        var act = await actRes.ReadAsync<IdDto>();
        await _client.PostAsJsonAsync("/api/occurrences", new { activityId = act.Id });

        var res = await _client.GetAsync("/api/export");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        var doc = await res.ReadAsync<JsonElement>();
        Assert.Equal("testuser", doc.GetProperty("user").GetProperty("username").GetString());
        Assert.True(doc.GetProperty("settings").TryGetProperty("timezone", out _));
        Assert.Single(doc.GetProperty("categories").EnumerateArray());
        var exportedGoal = Assert.Single(doc.GetProperty("goals").EnumerateArray());
        Assert.Single(exportedGoal.GetProperty("checkpoints").EnumerateArray());
        Assert.Single(doc.GetProperty("activities").EnumerateArray());
        var occ = Assert.Single(doc.GetProperty("occurrences").EnumerateArray());
        Assert.Equal("Practice", occ.GetProperty("title").GetString());
    }

    public void Dispose() => _factory.Dispose();

    private sealed record IdDto(Guid Id);
}
