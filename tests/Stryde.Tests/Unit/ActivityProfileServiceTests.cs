using Stryde.Core.Common;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;
using Stryde.Core.Enums;

namespace Stryde.Tests.Unit;

public class ActivityProfileServiceTests : IDisposable
{
    private readonly TestContext _ctx = new();

    public void Dispose() => _ctx.Dispose();

    private async Task<Guid> CreateUserAsync()
    {
        var user = new User
        {
            Username = "u" + Guid.NewGuid().ToString("N")[..8],
            PasswordHash = "x",
            Timezone = "UTC",
        };
        _ctx.Db.Users.Add(user);
        await _ctx.Db.SaveChangesAsync();
        return user.Id;
    }

    private static UpdateActivityProfileRequest Req(
        string start = "09:00", string end = "17:00", int minBlock = 90, int maxPerDay = 2) =>
        new(start, end, minBlock, maxPerDay);

    [Fact]
    public async Task GetDtosAsync_returns_every_type_at_its_default()
    {
        var userId = await CreateUserAsync();

        var dtos = await _ctx.ActivityProfileService.GetDtosAsync(userId);

        Assert.Equal(ActivityProfiles.AllTypes.Count, dtos.Count);
        Assert.All(dtos, d => Assert.False(d.IsCustomised));
        var deepWork = dtos.Single(d => d.Type == nameof(ActivityType.deepWork));
        Assert.Equal("09:00", deepWork.WindowStart);
        Assert.Equal(90, deepWork.MinBlockMinutes);
    }

    [Fact]
    public async Task UpdateAsync_stores_only_the_fields_that_differ_from_the_default()
    {
        var userId = await CreateUserAsync();

        // deepWork's default is 09:00-17:00 / 90 / 2; only the window end moves
        await _ctx.ActivityProfileService.UpdateAsync(userId, ActivityType.deepWork, Req(end: "19:00"));

        var row = Assert.Single(_ctx.Db.ActivityTypeSettings);
        Assert.Equal(new TimeOnly(19, 0), row.WindowEnd);
        Assert.Null(row.WindowStart);
        Assert.Null(row.MinBlockMinutes);
        Assert.Null(row.MaxPerDay);
    }

    [Fact]
    public async Task UpdateAsync_writes_no_row_when_every_field_matches_the_default()
    {
        var userId = await CreateUserAsync();

        var result = await _ctx.ActivityProfileService.UpdateAsync(userId, ActivityType.deepWork, Req());

        Assert.True(result.IsSuccess);
        Assert.Empty(_ctx.Db.ActivityTypeSettings);
        Assert.All(result.Value!, d => Assert.False(d.IsCustomised));
    }

    [Fact]
    public async Task UpdateAsync_back_to_the_default_drops_an_existing_override()
    {
        var userId = await CreateUserAsync();
        await _ctx.ActivityProfileService.UpdateAsync(userId, ActivityType.deepWork, Req(end: "19:00"));

        await _ctx.ActivityProfileService.UpdateAsync(userId, ActivityType.deepWork, Req());

        Assert.Empty(_ctx.Db.ActivityTypeSettings);
    }

    [Fact]
    public async Task ResolveAsync_layers_overrides_over_the_defaults()
    {
        var userId = await CreateUserAsync();
        await _ctx.ActivityProfileService.UpdateAsync(userId, ActivityType.deepWork, Req(minBlock: 45));

        var profiles = await _ctx.ActivityProfileService.ResolveAsync(userId);

        Assert.Equal(45, profiles[ActivityType.deepWork].MinBlockMinutes);
        // Untouched fields still come from the defaults, as do untouched types
        Assert.Equal(new TimeOnly(9, 0), profiles[ActivityType.deepWork].WindowStart);
        Assert.Equal(ActivityProfiles.For(ActivityType.general), profiles[ActivityType.general]);
    }

    [Fact]
    public async Task ResolveAsync_keeps_the_uneditable_parameters()
    {
        var userId = await CreateUserAsync();
        await _ctx.ActivityProfileService.UpdateAsync(userId, ActivityType.training, Req(minBlock: 60, maxPerDay: 3));

        var profile = (await _ctx.ActivityProfileService.ResolveAsync(userId))[ActivityType.training];

        Assert.Equal(ActivityProfiles.For(ActivityType.training).CadencePriorDays, profile.CadencePriorDays);
        Assert.Equal(ActivityProfiles.For(ActivityType.training).MinDueFraction, profile.MinDueFraction);
    }

    [Fact]
    public async Task ResolveAsync_ignores_another_users_overrides()
    {
        var mine = await CreateUserAsync();
        var theirs = await CreateUserAsync();
        await _ctx.ActivityProfileService.UpdateAsync(theirs, ActivityType.deepWork, Req(minBlock: 45));

        var profiles = await _ctx.ActivityProfileService.ResolveAsync(mine);

        Assert.Equal(90, profiles[ActivityType.deepWork].MinBlockMinutes);
    }

    [Fact]
    public async Task ResetAsync_restores_the_default()
    {
        var userId = await CreateUserAsync();
        await _ctx.ActivityProfileService.UpdateAsync(userId, ActivityType.deepWork, Req(minBlock: 45));

        var result = await _ctx.ActivityProfileService.ResetAsync(userId, ActivityType.deepWork);

        Assert.True(result.IsSuccess);
        Assert.Empty(_ctx.Db.ActivityTypeSettings);
        Assert.Equal(90, result.Value!.Single(d => d.Type == nameof(ActivityType.deepWork)).MinBlockMinutes);
    }

    [Fact]
    public async Task ResetAsync_is_a_no_op_for_a_type_that_was_never_overridden()
    {
        var userId = await CreateUserAsync();

        var result = await _ctx.ActivityProfileService.ResetAsync(userId, ActivityType.general);

        Assert.True(result.IsSuccess);
    }

    [Theory]
    [InlineData("17:00", "09:00", 90, 2)]  // window ends before it starts
    [InlineData("09:00", "09:00", 90, 2)]  // empty window
    [InlineData("9am", "17:00", 90, 2)]    // unparseable
    [InlineData("09:00", "17:00", -1, 2)]  // negative block
    [InlineData("09:00", "17:00", 999, 2)] // block past the ceiling
    [InlineData("09:00", "17:00", 90, -1)] // negative cap
    [InlineData("09:00", "17:00", 90, 99)] // cap past the ceiling
    public async Task UpdateAsync_rejects_out_of_range_values(string start, string end, int minBlock, int maxPerDay)
    {
        var userId = await CreateUserAsync();

        var result = await _ctx.ActivityProfileService.UpdateAsync(
            userId, ActivityType.deepWork, new UpdateActivityProfileRequest(start, end, minBlock, maxPerDay));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
        Assert.Empty(_ctx.Db.ActivityTypeSettings);
    }

    [Fact]
    public async Task UpdateAsync_rejects_an_unknown_user()
    {
        var result = await _ctx.ActivityProfileService.UpdateAsync(Guid.NewGuid(), ActivityType.deepWork, Req(minBlock: 45));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.NotFound, result.Error!.Type);
    }
}
