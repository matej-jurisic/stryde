using System.Net;
using System.Net.Http.Json;
using Xunit;

namespace Stryde.Tests.Integration;

public class ActivityTests : IDisposable
{
    private readonly StrydeApiFactory _factory = new();
    private readonly HttpClient _client;

    public ActivityTests()
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
    public async Task CreateActivity_ReturnsDto()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);
        var goalId = await CreateGoalAsync();

        var res = await _client.PostAsJsonAsync("/api/activities", new { title = "Morning run", goalId });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);

        var activity = await res.ReadAsync<ActivityDto>();
        Assert.Equal("Morning run", activity.Title);
        Assert.Equal(goalId, activity.GoalId);
    }

    [Fact]
    public async Task CreateActivity_UnknownGoal_Returns404()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);

        var res = await _client.PostAsJsonAsync("/api/activities", new { title = "Task", goalId = Guid.NewGuid() });
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }

    [Fact]
    public async Task UpdateActivity_ChangesTitle()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);
        var goalId = await CreateGoalAsync();

        var createRes = await _client.PostAsJsonAsync("/api/activities", new { title = "Old title", goalId });
        var created = await createRes.ReadAsync<ActivityDto>();

        var updateRes = await _client.PutAsJsonAsync($"/api/activities/{created.Id}", new { title = "New title" });
        Assert.Equal(HttpStatusCode.OK, updateRes.StatusCode);

        var updated = await updateRes.ReadAsync<ActivityDto>();
        Assert.Equal("New title", updated.Title);
    }

    [Fact]
    public async Task DeleteActivity_Returns204()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);
        var goalId = await CreateGoalAsync();

        var createRes = await _client.PostAsJsonAsync("/api/activities", new { title = "To delete", goalId });
        var created = await createRes.ReadAsync<ActivityDto>();

        var deleteRes = await _client.DeleteAsync($"/api/activities/{created.Id}");
        Assert.Equal(HttpStatusCode.NoContent, deleteRes.StatusCode);
    }

    [Fact]
    public async Task ListActivities_FilteredByGoal()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);
        var goal1Id = await CreateGoalAsync("Goal 1");
        var goal2Id = await CreateGoalAsync("Goal 2");

        await _client.PostAsJsonAsync("/api/activities", new { title = "Template A", goalId = goal1Id });
        await _client.PostAsJsonAsync("/api/activities", new { title = "Template B", goalId = goal1Id });
        await _client.PostAsJsonAsync("/api/activities", new { title = "Template C", goalId = goal2Id });

        var res = await _client.GetAsync($"/api/activities?goalId={goal1Id}");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        var list = await res.ReadAsync<List<ActivityDto>>();
        Assert.Equal(2, list.Count);
        Assert.All(list, a => Assert.Equal(goal1Id, a.GoalId));
    }

    public void Dispose() => _factory.Dispose();

    private sealed record ActivityDto(Guid Id, Guid UserId, string Title, Guid? CategoryId, Guid? GoalId, DateTimeOffset CreatedAt);
    private sealed record GoalDto(Guid Id, string Title, string Status);
}
