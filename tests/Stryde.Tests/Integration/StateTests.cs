using System.Net;
using System.Net.Http.Json;
using Stryde.Core.Dtos;

namespace Stryde.Tests.Integration;

public class StateTests : IDisposable
{
    private readonly StrydeApiFactory _factory = new();
    private readonly HttpClient _client;

    public StateTests()
    {
        _client = _factory.CreateClient();
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    private async Task AuthenticateAsync()
    {
        var token = await _client.SetupUserAsync();
        _client.UseBearer(token);
    }

    private async Task<StateDto> CreateStateAsync(string name = "Location")
    {
        var res = await _client.PostAsJsonAsync("/api/states", new { name });
        res.EnsureSuccessStatusCode();
        return await res.ReadAsync<StateDto>();
    }

    private async Task<StateDto> AddValueAsync(
        Guid stateId, string name, bool isDefault = false, int? durationMinutes = null)
    {
        var res = await _client.PostAsJsonAsync(
            $"/api/states/{stateId}/values", new { name, isDefault, durationMinutes });
        res.EnsureSuccessStatusCode();
        return await res.ReadAsync<StateDto>();
    }

    [Fact]
    public async Task Get_states_requires_authentication()
    {
        var res = await _client.GetAsync("/api/states");

        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Create_and_list_round_trips_a_state_with_its_values()
    {
        await AuthenticateAsync();
        var state = await CreateStateAsync();
        await AddValueAsync(state.Id, "Home");
        await AddValueAsync(state.Id, "Work");

        var listed = await (await _client.GetAsync("/api/states")).ReadAsync<List<StateDto>>();

        var only = Assert.Single(listed);
        Assert.Equal("Location", only.Name);
        Assert.Equal(["Home", "Work"], only.Values.Select(v => v.Name));
        Assert.Equal("Home", Assert.Single(only.Values, v => v.IsDefault).Name);
    }

    [Fact]
    public async Task Add_value_rejects_a_duration_on_the_default()
    {
        await AuthenticateAsync();
        var state = await CreateStateAsync("Tired");

        var res = await _client.PostAsJsonAsync(
            $"/api/states/{state.Id}/values", new { name = "No", durationMinutes = 60 });

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Delete_value_conflicts_while_an_activity_requires_it()
    {
        await AuthenticateAsync();
        var state = await CreateStateAsync();
        await AddValueAsync(state.Id, "Home");
        var withWork = await AddValueAsync(state.Id, "Work");
        var work = withWork.Values.Single(v => v.Name == "Work");

        var activityRes = await _client.PostAsJsonAsync("/api/activities", new
        {
            title = "commute home",
            requiredStateValueIds = new[] { work.Id },
        });
        activityRes.EnsureSuccessStatusCode();

        var res = await _client.DeleteAsync($"/api/states/{state.Id}/values/{work.Id}");

        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
    }

    [Fact]
    public async Task Activity_round_trips_its_effects_and_requirements()
    {
        await AuthenticateAsync();
        var state = await CreateStateAsync();
        await AddValueAsync(state.Id, "Home");
        var withWork = await AddValueAsync(state.Id, "Work");
        var home = withWork.Values.Single(v => v.Name == "Home");
        var work = withWork.Values.Single(v => v.Name == "Work");

        var created = await (await _client.PostAsJsonAsync("/api/activities", new
        {
            title = "commute in",
            setsStateValueIds = new[] { work.Id },
            requiredStateValueIds = new[] { home.Id },
        })).ReadAsync<ActivityDto>();

        Assert.Equal([work.Id], created.SetsStateValueIds);
        Assert.Equal([home.Id], created.RequiredStateValueIds);

        // The PUT is a full replace, so the same fields have to survive a round trip through it.
        var updated = await (await _client.PutAsJsonAsync($"/api/activities/{created.Id}", new
        {
            title = "commute in",
            setsStateValueIds = new[] { home.Id },
            requiredStateValueIds = new[] { work.Id },
        })).ReadAsync<ActivityDto>();

        Assert.Equal([home.Id], updated.SetsStateValueIds);
        Assert.Equal([work.Id], updated.RequiredStateValueIds);
    }

    [Fact]
    public async Task Activity_rejects_setting_two_values_of_one_state()
    {
        await AuthenticateAsync();
        var state = await CreateStateAsync();
        await AddValueAsync(state.Id, "Home");
        var withWork = await AddValueAsync(state.Id, "Work");

        var res = await _client.PostAsJsonAsync("/api/activities", new
        {
            title = "teleport",
            setsStateValueIds = withWork.Values.Select(v => v.Id).ToArray(),
        });

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Activity_rejects_a_state_value_belonging_to_another_user()
    {
        await AuthenticateAsync();
        var state = await CreateStateAsync();
        var withHome = await AddValueAsync(state.Id, "Home");
        var home = withHome.Values[0];

        var otherToken = await _client.SetupUserAsync("otheruser");
        _client.UseBearer(otherToken);

        var res = await _client.PostAsJsonAsync("/api/activities", new
        {
            title = "run",
            requiredStateValueIds = new[] { home.Id },
        });

        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }
}
