using System.Net;
using System.Net.Http.Json;
using Stryde.Core.Common;
using Xunit;

namespace Stryde.Tests.Integration;

public class ActivityProfileTests : IDisposable
{
    private readonly StrydeApiFactory _factory = new();
    private readonly HttpClient _client;

    public ActivityProfileTests()
    {
        _client = _factory.CreateClient();
    }

    public void Dispose() => _factory.Dispose();

    private sealed record ProfileDto(
        string Type, string WindowStart, string WindowEnd, int MinBlockMinutes, int MaxPerDay,
        double CadencePriorDays, double MinDueFraction, bool IsCustomised);

    private static object Body(
        string windowStart = "09:00", string windowEnd = "17:00", int minBlockMinutes = 90, int maxPerDay = 2) =>
        new { windowStart, windowEnd, minBlockMinutes, maxPerDay };

    [Fact]
    public async Task List_RequiresAuth()
    {
        var res = await _client.GetAsync("/api/settings/activity-types");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task List_ReturnsEveryTypeAtItsDefault()
    {
        _client.UseBearer(await _client.SetupUserAsync());

        var profiles = await (await _client.GetAsync("/api/settings/activity-types")).ReadAsync<List<ProfileDto>>();

        Assert.Equal(ActivityProfiles.AllTypes.Count, profiles.Count);
        Assert.All(profiles, p => Assert.False(p.IsCustomised));
        var deepWork = profiles.Single(p => p.Type == "deepWork");
        Assert.Equal("09:00", deepWork.WindowStart);
        Assert.Equal(90, deepWork.MinBlockMinutes);
    }

    [Fact]
    public async Task Update_AppliesTheOverrideAndFlagsItCustom()
    {
        _client.UseBearer(await _client.SetupUserAsync());

        var res = await _client.PutAsJsonAsync("/api/settings/activity-types/deepWork", Body(minBlockMinutes: 45));

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var deepWork = (await res.ReadAsync<List<ProfileDto>>()).Single(p => p.Type == "deepWork");
        Assert.Equal(45, deepWork.MinBlockMinutes);
        Assert.True(deepWork.IsCustomised);
        // The uneditable parameters survive an edit
        Assert.Equal(3.0, deepWork.CadencePriorDays);
    }

    [Fact]
    public async Task Update_RejectsAnInvertedWindow()
    {
        _client.UseBearer(await _client.SetupUserAsync());

        var res = await _client.PutAsJsonAsync("/api/settings/activity-types/deepWork", Body(windowStart: "18:00", windowEnd: "09:00"));

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Update_RejectsAnUnknownType()
    {
        _client.UseBearer(await _client.SetupUserAsync());

        var res = await _client.PutAsJsonAsync("/api/settings/activity-types/nonsense", Body());

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Delete_RestoresTheDefault()
    {
        _client.UseBearer(await _client.SetupUserAsync());
        await _client.PutAsJsonAsync("/api/settings/activity-types/deepWork", Body(minBlockMinutes: 45));

        var res = await _client.DeleteAsync("/api/settings/activity-types/deepWork");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var deepWork = (await res.ReadAsync<List<ProfileDto>>()).Single(p => p.Type == "deepWork");
        Assert.Equal(90, deepWork.MinBlockMinutes);
        Assert.False(deepWork.IsCustomised);
    }

    [Fact]
    public async Task Profiles_AreScopedToTheUser()
    {
        _client.UseBearer(await _client.SetupUserAsync("first"));
        await _client.PutAsJsonAsync("/api/settings/activity-types/deepWork", Body(minBlockMinutes: 45));

        _client.UseBearer(await _client.SetupUserAsync("second"));
        var profiles = await (await _client.GetAsync("/api/settings/activity-types")).ReadAsync<List<ProfileDto>>();

        Assert.Equal(90, profiles.Single(p => p.Type == "deepWork").MinBlockMinutes);
    }
}
