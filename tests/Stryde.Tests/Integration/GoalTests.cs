using System.Net;
using System.Net.Http.Json;
using Xunit;

namespace Stryde.Tests.Integration;

public class GoalTests : IDisposable
{
    private readonly StrydeApiFactory _factory = new();
    private readonly HttpClient _client;

    public GoalTests()
    {
        _client = _factory.CreateClient();
    }

    [Fact]
    public async Task CreateGoal_ReturnsDto()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);

        var res = await _client.PostAsJsonAsync("/api/goals", new { title = "My Goal", description = "A test goal" });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);

        var goal = await res.ReadAsync<GoalDto>();
        Assert.Equal("My Goal", goal.Title);
        Assert.Equal("active", goal.Status);
    }

    [Fact]
    public async Task SetGoalStatus_Focus_BlocksAtLimit()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);

        // Set max focus goals to 1 via settings
        await _client.PutAsJsonAsync("/api/settings", new { maxFocusGoals = 1, dayBoundaryTime = "00:00" });

        // Create two goals
        var res1 = await _client.PostAsJsonAsync("/api/goals", new { title = "Goal 1" });
        var g1 = await res1.ReadAsync<GoalDto>();
        var res2 = await _client.PostAsJsonAsync("/api/goals", new { title = "Goal 2" });
        var g2 = await res2.ReadAsync<GoalDto>();

        // Focus first - should succeed
        var focus1 = await _client.PostAsJsonAsync($"/api/goals/{g1.Id}/status", new { status = "focus" });
        Assert.Equal(HttpStatusCode.OK, focus1.StatusCode);

        // Focus second - should fail with 409
        var focus2 = await _client.PostAsJsonAsync($"/api/goals/{g2.Id}/status", new { status = "focus" });
        Assert.Equal(HttpStatusCode.Conflict, focus2.StatusCode);
    }

    [Fact]
    public async Task ListGoals_FilterByStatus()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);

        var r1 = await _client.PostAsJsonAsync("/api/goals", new { title = "Active Goal" });
        var g1 = await r1.ReadAsync<GoalDto>();
        await _client.PostAsJsonAsync("/api/goals", new { title = "Bench Goal" });

        await _client.PostAsJsonAsync($"/api/goals/{g1.Id}/status", new { status = "bench" });

        var res = await _client.GetAsync("/api/goals?status=bench");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var goals = await res.ReadAsync<List<GoalDto>>();
        Assert.All(goals, g => Assert.Equal("bench", g.Status));
    }

    public void Dispose() => _factory.Dispose();

    private sealed record GoalDto(Guid Id, string Title, string Status);
}
