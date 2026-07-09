using System.Net;
using System.Net.Http.Json;
using Xunit;

namespace Stryde.Tests.Integration;

public class BaseEventTests : IDisposable
{
    private readonly StrydeApiFactory _factory = new();
    private readonly HttpClient _client;

    public BaseEventTests()
    {
        _client = _factory.CreateClient();
    }

    private async Task<Guid> CreateGoalAsync(string title = "Test Goal")
    {
        var res = await _client.PostAsJsonAsync("/api/goals", new { title });
        res.EnsureSuccessStatusCode();
        var goal = await res.ReadAsync<GoalDto>();
        return goal.Id;
    }

    [Fact]
    public async Task CreateBaseEvent_ReturnsDto()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);
        var goalId = await CreateGoalAsync();

        var res = await _client.PostAsJsonAsync($"/api/goals/{goalId}/base-events", new { title = "Morning run" });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);

        var be = await res.ReadAsync<BaseEventDto>();
        Assert.Equal("Morning run", be.Title);
        Assert.Equal(goalId, be.GoalId);
    }

    [Fact]
    public async Task CreateBaseEvent_UnknownGoal_Returns404()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);

        var res = await _client.PostAsJsonAsync($"/api/goals/{Guid.NewGuid()}/base-events", new { title = "Task" });
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }

    [Fact]
    public async Task UpdateBaseEvent_ChangesTitle()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);
        var goalId = await CreateGoalAsync();

        var createRes = await _client.PostAsJsonAsync($"/api/goals/{goalId}/base-events", new { title = "Old title" });
        var created = await createRes.ReadAsync<BaseEventDto>();

        var updateRes = await _client.PutAsJsonAsync($"/api/base-events/{created.Id}", new { title = "New title" });
        Assert.Equal(HttpStatusCode.OK, updateRes.StatusCode);

        var updated = await updateRes.ReadAsync<BaseEventDto>();
        Assert.Equal("New title", updated.Title);
    }

    [Fact]
    public async Task DeleteBaseEvent_Returns204()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);
        var goalId = await CreateGoalAsync();

        var createRes = await _client.PostAsJsonAsync($"/api/goals/{goalId}/base-events", new { title = "To delete" });
        var created = await createRes.ReadAsync<BaseEventDto>();

        var deleteRes = await _client.DeleteAsync($"/api/base-events/{created.Id}");
        Assert.Equal(HttpStatusCode.NoContent, deleteRes.StatusCode);
    }

    [Fact]
    public async Task ListBaseEvents_ReturnsGoalTemplates()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);
        var goal1Id = await CreateGoalAsync("Goal 1");
        var goal2Id = await CreateGoalAsync("Goal 2");

        await _client.PostAsJsonAsync($"/api/goals/{goal1Id}/base-events", new { title = "Template A" });
        await _client.PostAsJsonAsync($"/api/goals/{goal1Id}/base-events", new { title = "Template B" });
        await _client.PostAsJsonAsync($"/api/goals/{goal2Id}/base-events", new { title = "Template C" });

        var res = await _client.GetAsync($"/api/goals/{goal1Id}/base-events");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        var list = await res.ReadAsync<List<BaseEventDto>>();
        Assert.Equal(2, list.Count);
        Assert.All(list, b => Assert.Equal(goal1Id, b.GoalId));
    }

    public void Dispose() => _factory.Dispose();

    private sealed record BaseEventDto(Guid Id, Guid GoalId, string Title);
    private sealed record GoalDto(Guid Id, string Title, string Status);
}
