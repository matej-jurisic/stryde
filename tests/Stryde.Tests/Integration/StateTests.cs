using System.Net;
using System.Net.Http.Json;
using Stryde.Core.Common;
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

    private async Task<StateDto> AddValueAsync(Guid stateId, string name, bool isDefault = false)
    {
        var res = await _client.PostAsJsonAsync(
            $"/api/states/{stateId}/values", new { name, isDefault });
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
            setsStateValues = new[] { new { stateValueId = work.Id, durationMinutes = (int?)480 } },
            requiredStateValueIds = new[] { home.Id },
        })).ReadAsync<ActivityDto>();

        Assert.Equal(work.Id, Assert.Single(created.SetsStateValues).StateValueId);
        Assert.Equal(480, created.SetsStateValues[0].DurationMinutes);
        Assert.Equal([home.Id], created.RequiredStateValueIds);

        // The PUT is a full replace, so the same fields have to survive a round trip through it.
        var updated = await (await _client.PutAsJsonAsync($"/api/activities/{created.Id}", new
        {
            title = "commute in",
            setsStateValues = new[] { new { stateValueId = work.Id, durationMinutes = (int?)null } },
            requiredStateValueIds = new[] { work.Id },
        })).ReadAsync<ActivityDto>();

        Assert.Equal(work.Id, Assert.Single(updated.SetsStateValues).StateValueId);
        Assert.Null(updated.SetsStateValues[0].DurationMinutes);
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
            setsStateValues = withWork.Values.Select(v => new { stateValueId = v.Id }).ToArray(),
        });

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Activity_rejects_an_expiry_on_a_change_to_the_default_value()
    {
        await AuthenticateAsync();
        var state = await CreateStateAsync("Tired");
        var withNo = await AddValueAsync(state.Id, "No");

        // The default is what an expiry falls back to, so an expiring change *to* it decays to itself.
        var res = await _client.PostAsJsonAsync("/api/activities", new
        {
            title = "recover",
            setsStateValues = new[] { new { stateValueId = withNo.Values[0].Id, durationMinutes = 60 } },
        });

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Activity_rejects_an_expiry_past_the_ceiling()
    {
        await AuthenticateAsync();
        var state = await CreateStateAsync("Tired");
        await AddValueAsync(state.Id, "No");
        var withYes = await AddValueAsync(state.Id, "Yes");
        var yes = withYes.Values.Single(v => v.Name == "Yes");

        var res = await _client.PostAsJsonAsync("/api/activities", new
        {
            title = "hike",
            setsStateValues = new[] { new
            {
                stateValueId = yes.Id,
                durationMinutes = Validators.MaxStateDurationMinutes + 1,
            } },
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
