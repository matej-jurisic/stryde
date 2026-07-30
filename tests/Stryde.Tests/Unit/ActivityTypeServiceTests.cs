using Microsoft.EntityFrameworkCore;
using Stryde.Core.Common;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;
using Xunit;

namespace Stryde.Tests.Unit;

public class ActivityTypeServiceTests : IDisposable
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

    private static CreateActivityTypeRequest Req(
        string name = "Errands", string? icon = null,
        string windowStart = "10:00", string windowEnd = "18:00",
        int minBlockMinutes = 0, int maxPerDay = 0,
        double cadencePriorDays = 7.0, double minDueFraction = 0) =>
        new(name, icon, windowStart, windowEnd, minBlockMinutes, maxPerDay, cadencePriorDays, minDueFraction);

    [Fact]
    public async Task CreateAsync_stores_every_field()
    {
        var userId = await CreateUserAsync();

        var result = await _ctx.ActivityTypeService.CreateAsync(userId, Req(
            icon: "ShoppingBag", minBlockMinutes: 30, maxPerDay: 3,
            cadencePriorDays: 2.5, minDueFraction: 0.5));

        Assert.True(result.IsSuccess);
        var dto = result.Value!;
        Assert.Equal("Errands", dto.Name);
        Assert.Equal("ShoppingBag", dto.Icon);
        Assert.Equal("10:00", dto.WindowStart);
        Assert.Equal("18:00", dto.WindowEnd);
        Assert.Equal(30, dto.MinBlockMinutes);
        Assert.Equal(3, dto.MaxPerDay);
        Assert.Equal(2.5, dto.CadencePriorDays);
        Assert.Equal(0.5, dto.MinDueFraction);
    }

    [Fact]
    public async Task CreateAsync_rejects_a_blank_name()
    {
        var userId = await CreateUserAsync();

        var result = await _ctx.ActivityTypeService.CreateAsync(userId, Req(name: "  "));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
    }

    [Fact]
    public async Task CreateAsync_rejects_an_inverted_window()
    {
        var userId = await CreateUserAsync();

        var result = await _ctx.ActivityTypeService.CreateAsync(
            userId, Req(windowStart: "18:00", windowEnd: "09:00"));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(481)]
    public async Task CreateAsync_rejects_a_block_floor_outside_the_bounds(int minutes)
    {
        var userId = await CreateUserAsync();

        var result = await _ctx.ActivityTypeService.CreateAsync(userId, Req(minBlockMinutes: minutes));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-2.5)]
    public async Task CreateAsync_rejects_a_non_positive_cadence(double days)
    {
        var userId = await CreateUserAsync();

        // Zero would make everything of this type permanently due, which is not a cadence.
        var result = await _ctx.ActivityTypeService.CreateAsync(userId, Req(cadencePriorDays: days));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
    }

    [Fact]
    public async Task CreateAsync_rejects_a_cooldown_above_one()
    {
        var userId = await CreateUserAsync();

        var result = await _ctx.ActivityTypeService.CreateAsync(userId, Req(minDueFraction: 1.5));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
    }

    [Fact]
    public async Task UpdateAsync_returns_NotFound_for_another_users_type()
    {
        var owner = await CreateUserAsync();
        var stranger = await CreateUserAsync();
        var created = (await _ctx.ActivityTypeService.CreateAsync(owner, Req())).Value!;

        var result = await _ctx.ActivityTypeService.UpdateAsync(
            created.Id, stranger, new UpdateActivityTypeRequest("Stolen", null, "09:00", "17:00", 0, 0, 7.0, 0));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.NotFound, result.Error!.Type);
    }

    [Fact]
    public async Task DeleteAsync_leaves_its_activities_alive_with_no_type()
    {
        var userId = await CreateUserAsync();
        var type = (await _ctx.ActivityTypeService.CreateAsync(userId, Req())).Value!;
        var activity = new Activity { UserId = userId, Title = "post office", ActivityTypeId = type.Id };
        _ctx.Db.Activities.Add(activity);
        await _ctx.Db.SaveChangesAsync();

        var result = await _ctx.ActivityTypeService.DeleteAsync(type.Id, userId);

        Assert.True(result.IsSuccess);
        // Set-null rather than cascade, exactly as a deleted category behaves: the activity survives,
        // it just stops being scheduled to a preset.
        var survivor = await _ctx.Db.Activities.AsNoTracking().SingleAsync(a => a.Id == activity.Id);
        Assert.Null(survivor.ActivityTypeId);
    }

    [Fact]
    public async Task SeedDefaultsAsync_produces_the_three_starting_types()
    {
        var userId = await CreateUserAsync();

        await _ctx.ActivityTypeService.SeedDefaultsAsync(userId);

        var types = await _ctx.ActivityTypeService.ListAsync(userId);
        Assert.Equal(["General", "Training", "Deep work"], types.Select(t => t.Name));
    }

    [Fact]
    public async Task SeedDefaultsAsync_seeds_nothing_the_editor_cannot_reproduce()
    {
        var userId = await CreateUserAsync();
        await _ctx.ActivityTypeService.SeedDefaultsAsync(userId);

        var types = await _ctx.ActivityTypeService.ListAsync(userId);

        // The whole point of types-as-rows is that no built-in is privileged. A seeded value the
        // editor's dropdown cannot express would make one quietly unreachable by hand.
        double[] cadenceOptions = [1, 2.5, 7, 14];
        double[] cooldownOptions = [0, 0.5, 1.0];
        Assert.All(types, t => Assert.Contains(t.CadencePriorDays, cadenceOptions));
        Assert.All(types, t => Assert.Contains(t.MinDueFraction, cooldownOptions));
    }

    [Fact]
    public async Task ListAsync_is_scoped_to_the_user()
    {
        var mine = await CreateUserAsync();
        var theirs = await CreateUserAsync();
        await _ctx.ActivityTypeService.CreateAsync(mine, Req(name: "Mine"));
        await _ctx.ActivityTypeService.CreateAsync(theirs, Req(name: "Theirs"));

        var types = await _ctx.ActivityTypeService.ListAsync(mine);

        Assert.Equal("Mine", Assert.Single(types).Name);
    }

    [Fact]
    public async Task ResolveAsync_omits_nothing_the_engine_needs()
    {
        var userId = await CreateUserAsync();
        var type = (await _ctx.ActivityTypeService.CreateAsync(
            userId, Req(minBlockMinutes: 45, maxPerDay: 2, cadencePriorDays: 2.5, minDueFraction: 0.5))).Value!;

        var profiles = await _ctx.ActivityTypeService.ResolveAsync(userId);

        var profile = profiles[type.Id];
        Assert.Equal(new TimeOnly(10, 0), profile.WindowStart);
        Assert.Equal(45, profile.MinBlockMinutes);
        Assert.Equal(2, profile.MaxPerDay);
        Assert.Equal(2.5, profile.CadencePriorDays);
        Assert.Equal(0.5, profile.MinDueFraction);
    }
}
