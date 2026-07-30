using System.Net;
using System.Net.Http.Json;
using Xunit;

namespace Stryde.Tests.Integration;

public class ActivityTypeTests : IDisposable
{
    private readonly StrydeApiFactory _factory = new();
    private readonly HttpClient _client;

    public ActivityTypeTests()
    {
        _client = _factory.CreateClient();
    }

    public void Dispose() => _factory.Dispose();

    private sealed record TypeDto(
        Guid Id, string Name, string? Icon, string WindowStart, string WindowEnd,
        int MinBlockMinutes, int MaxPerDay, double CadencePriorDays, double MinDueFraction);

    private sealed record ActivityDto(Guid Id, Guid? ActivityTypeId);

    private static object Body(
        string name = "Errands", string? icon = null,
        string windowStart = "10:00", string windowEnd = "18:00",
        int minBlockMinutes = 0, int maxPerDay = 0,
        double cadencePriorDays = 7.0, double minDueFraction = 0) =>
        new { name, icon, windowStart, windowEnd, minBlockMinutes, maxPerDay, cadencePriorDays, minDueFraction };

    private Task<List<TypeDto>> ListAsync() =>
        _client.GetAsync("/api/activity-types").ContinueWith(t => t.Result.ReadAsync<List<TypeDto>>()).Unwrap();

    [Fact]
    public async Task List_RequiresAuth()
    {
        var res = await _client.GetAsync("/api/activity-types");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task List_ReturnsTheTypesSeededAtRegistration()
    {
        _client.UseBearer(await _client.SetupUserAsync());

        var types = await ListAsync();

        Assert.Equal(["General", "Training", "Deep work"], types.Select(t => t.Name));
        var deepWork = types.Single(t => t.Name == "Deep work");
        Assert.Equal("09:00", deepWork.WindowStart);
        Assert.Equal(90, deepWork.MinBlockMinutes);
    }

    [Fact]
    public async Task Create_AddsAType()
    {
        _client.UseBearer(await _client.SetupUserAsync());

        var res = await _client.PostAsJsonAsync("/api/activity-types", Body(icon: "ShoppingBag"));

        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var created = await res.ReadAsync<TypeDto>();
        Assert.Equal("Errands", created.Name);
        Assert.Equal("ShoppingBag", created.Icon);
        Assert.Contains(await ListAsync(), t => t.Id == created.Id);
    }

    [Fact]
    public async Task Create_RejectsAnInvertedWindow()
    {
        _client.UseBearer(await _client.SetupUserAsync());

        var res = await _client.PostAsJsonAsync(
            "/api/activity-types", Body(windowStart: "18:00", windowEnd: "09:00"));

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Update_ChangesTheRow()
    {
        _client.UseBearer(await _client.SetupUserAsync());
        var created = await (await _client.PostAsJsonAsync("/api/activity-types", Body())).ReadAsync<TypeDto>();

        var res = await _client.PutAsJsonAsync(
            $"/api/activity-types/{created.Id}",
            Body(name: "Chores", windowStart: "11:00", minBlockMinutes: 30, cadencePriorDays: 2.5, minDueFraction: 0.5));

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var updated = await res.ReadAsync<TypeDto>();
        Assert.Equal("Chores", updated.Name);
        Assert.Equal("11:00", updated.WindowStart);
        Assert.Equal(30, updated.MinBlockMinutes);
        // Cadence and cooldown are editable now, which is the whole point of the phase
        Assert.Equal(2.5, updated.CadencePriorDays);
        Assert.Equal(0.5, updated.MinDueFraction);
    }

    [Fact]
    public async Task Update_AnotherUsersTypeIsNotFound()
    {
        _client.UseBearer(await _client.SetupUserAsync("first"));
        var created = await (await _client.PostAsJsonAsync("/api/activity-types", Body())).ReadAsync<TypeDto>();

        _client.UseBearer(await _client.SetupUserAsync("second"));
        var res = await _client.PutAsJsonAsync($"/api/activity-types/{created.Id}", Body(name: "Stolen"));

        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }

    [Fact]
    public async Task Delete_LeavesItsActivitiesWithNoType()
    {
        _client.UseBearer(await _client.SetupUserAsync());
        var type = await (await _client.PostAsJsonAsync("/api/activity-types", Body())).ReadAsync<TypeDto>();
        var activity = await (await _client.PostAsJsonAsync(
            "/api/activities", new { title = "post office", activityTypeId = type.Id })).ReadAsync<ActivityDto>();

        var res = await _client.DeleteAsync($"/api/activity-types/{type.Id}");

        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
        var survivor = await (await _client.GetAsync($"/api/activities/{activity.Id}")).ReadAsync<ActivityDto>();
        Assert.Null(survivor.ActivityTypeId);
    }

    [Fact]
    public async Task Types_AreScopedToTheUser()
    {
        _client.UseBearer(await _client.SetupUserAsync("first"));
        await _client.PostAsJsonAsync("/api/activity-types", Body(name: "Mine"));

        _client.UseBearer(await _client.SetupUserAsync("second"));
        var types = await ListAsync();

        Assert.DoesNotContain(types, t => t.Name == "Mine");
    }
}
