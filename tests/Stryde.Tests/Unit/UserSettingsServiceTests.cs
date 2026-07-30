using Stryde.Core.Common;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;

namespace Stryde.Tests.Unit;

public class UserSettingsServiceTests : IDisposable
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

    private async Task<(StateValue Home, StateValue Away)> AddLocationStateAsync(Guid userId)
    {
        var state = new State { UserId = userId, Name = "Location" };
        var home = new StateValue { StateId = state.Id, Name = "Home", IsDefault = true };
        var away = new StateValue { StateId = state.Id, Name = "Away" };
        _ctx.Db.States.Add(state);
        _ctx.Db.StateValues.AddRange(home, away);
        await _ctx.Db.SaveChangesAsync();
        return (home, away);
    }

    private static UpdateUserSettingsRequest Request(List<Guid>? mask = null) =>
        new(3, "00:00", "UTC", 6, mask);

    [Fact]
    public async Task UpdateAsync_stores_the_unaccounted_mask()
    {
        var userId = await CreateUserAsync();
        var (home, away) = await AddLocationStateAsync(userId);

        var result = await _ctx.UserSettingsService.UpdateAsync(userId, Request([home.Id, away.Id]));

        Assert.True(result.IsSuccess);
        Assert.Equal([home.Id, away.Id], result.Value!.UnaccountedStateValueIds.ToHashSet());

        var reread = await _ctx.UserSettingsService.GetDtoAsync(userId);
        Assert.Equal([home.Id, away.Id], reread.Value!.UnaccountedStateValueIds.ToHashSet());
    }

    [Fact]
    public async Task UpdateAsync_diffs_the_mask_rather_than_rebuilding_it()
    {
        var userId = await CreateUserAsync();
        var (home, away) = await AddLocationStateAsync(userId);
        await _ctx.UserSettingsService.UpdateAsync(userId, Request([home.Id, away.Id]));

        // Home survives the write untouched; re-adding an unchanged row would collide on its key.
        var result = await _ctx.UserSettingsService.UpdateAsync(userId, Request([home.Id]));

        Assert.True(result.IsSuccess);
        Assert.Equal(home.Id, Assert.Single(result.Value!.UnaccountedStateValueIds));
    }

    [Fact]
    public async Task UpdateAsync_null_mask_leaves_it_alone_and_an_empty_one_clears_it()
    {
        var userId = await CreateUserAsync();
        var (home, _) = await AddLocationStateAsync(userId);
        await _ctx.UserSettingsService.UpdateAsync(userId, Request([home.Id]));

        var untouched = await _ctx.UserSettingsService.UpdateAsync(userId, Request());
        Assert.Equal(home.Id, Assert.Single(untouched.Value!.UnaccountedStateValueIds));

        var cleared = await _ctx.UserSettingsService.UpdateAsync(userId, Request([]));
        Assert.Empty(cleared.Value!.UnaccountedStateValueIds);
    }

    [Fact]
    public async Task UpdateAsync_rejects_a_state_value_belonging_to_someone_else()
    {
        var userId = await CreateUserAsync();
        var otherId = await CreateUserAsync();
        var (theirHome, _) = await AddLocationStateAsync(otherId);

        var result = await _ctx.UserSettingsService.UpdateAsync(userId, Request([theirHome.Id]));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.NotFound, result.Error!.Type);
    }

    [Fact]
    public async Task GetUnaccountedMaskAsync_groups_values_by_their_state()
    {
        var userId = await CreateUserAsync();
        var (home, away) = await AddLocationStateAsync(userId);
        await _ctx.UserSettingsService.UpdateAsync(userId, Request([home.Id, away.Id]));

        var mask = await _ctx.UserSettingsService.GetUnaccountedMaskAsync(userId);

        var group = Assert.Single(mask);
        Assert.Equal(home.StateId, group.StateId);
        Assert.Equal([home.Id, away.Id], group.Allowed);
    }
}
