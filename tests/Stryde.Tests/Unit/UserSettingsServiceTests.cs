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

    // ── assistant settings ─────────────────────────────────────────────────

    private static UpdateUserSettingsRequest LlmRequest(
        bool? enabled = null, string? baseUrl = null, string? model = null,
        int? timeout = null, bool? noThink = null) =>
        new(3, "00:00", "UTC", 6, null, enabled, baseUrl, model, timeout, noThink);

    [Fact]
    public async Task UpdateAsync_stores_the_assistant_configuration()
    {
        var userId = await CreateUserAsync();

        var result = await _ctx.UserSettingsService.UpdateAsync(
            userId, LlmRequest(true, "http://ollama:11434/", "gemma3:27b", 300, true));

        Assert.True(result.IsSuccess);
        Assert.True(result.Value!.LlmEnabled);
        // The trailing slash is stripped on the way in, so paths are appended to a known shape.
        Assert.Equal("http://ollama:11434", result.Value.LlmBaseUrl);
        Assert.Equal("gemma3:27b", result.Value.LlmModel);
        Assert.Equal(300, result.Value.LlmTimeoutSeconds);
        Assert.True(result.Value.LlmNoThink);
    }

    [Fact]
    public async Task UpdateAsync_leaves_assistant_settings_alone_when_the_request_omits_them()
    {
        var userId = await CreateUserAsync();
        await _ctx.UserSettingsService.UpdateAsync(userId, LlmRequest(true, "http://ollama:11434", "gemma3:27b"));

        // A caller editing the day boundary knows nothing about the assistant and must not disable it.
        var result = await _ctx.UserSettingsService.UpdateAsync(userId, Request());

        Assert.True(result.Value!.LlmEnabled);
        Assert.Equal("gemma3:27b", result.Value.LlmModel);
    }

    [Fact]
    public async Task UpdateAsync_clears_an_assistant_field_given_an_empty_string()
    {
        var userId = await CreateUserAsync();
        await _ctx.UserSettingsService.UpdateAsync(userId, LlmRequest(true, "http://ollama:11434", "gemma3:27b"));

        var result = await _ctx.UserSettingsService.UpdateAsync(userId, LlmRequest(enabled: false, model: ""));

        Assert.Null(result.Value!.LlmModel);
        Assert.Equal("http://ollama:11434", result.Value.LlmBaseUrl);
    }

    [Fact]
    public async Task UpdateAsync_rejects_enabling_the_assistant_with_nothing_to_call()
    {
        var userId = await CreateUserAsync();

        var result = await _ctx.UserSettingsService.UpdateAsync(userId, LlmRequest(enabled: true));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
    }

    [Fact]
    public async Task UpdateAsync_rejects_a_server_address_that_is_not_an_http_url()
    {
        var userId = await CreateUserAsync();

        var result = await _ctx.UserSettingsService.UpdateAsync(userId, LlmRequest(baseUrl: "ollama:11434"));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
    }

    [Fact]
    public async Task UpdateAsync_rejects_an_out_of_range_timeout()
    {
        var userId = await CreateUserAsync();

        var result = await _ctx.UserSettingsService.UpdateAsync(userId, LlmRequest(timeout: 5000));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
    }

    [Fact]
    public async Task UpdateAsync_does_not_half_apply_a_rejected_assistant_change()
    {
        var userId = await CreateUserAsync();
        await _ctx.UserSettingsService.UpdateAsync(userId, LlmRequest(true, "http://ollama:11434", "gemma3:27b"));

        // Clearing the model while still enabled is refused; the address must not have moved either.
        var rejected = await _ctx.UserSettingsService.UpdateAsync(
            userId, LlmRequest(model: "", baseUrl: "http://elsewhere:11434"));
        Assert.False(rejected.IsSuccess);

        var after = await _ctx.UserSettingsService.GetDtoAsync(userId);
        Assert.Equal("http://ollama:11434", after.Value!.LlmBaseUrl);
        Assert.Equal("gemma3:27b", after.Value.LlmModel);
    }
}
