using Stryde.Core.Common;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;
using Stryde.Core.Services;

namespace Stryde.Tests.Unit;

public class StateServiceTests : IDisposable
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

    private async Task<StateDto> CreateStateAsync(Guid userId, string name = "Location")
    {
        var result = await _ctx.StateService.CreateAsync(userId, new CreateStateRequest(name));
        return result.Value!;
    }

    [Fact]
    public async Task CreateAsync_rejects_a_blank_name()
    {
        var userId = await CreateUserAsync();

        var result = await _ctx.StateService.CreateAsync(userId, new CreateStateRequest("  "));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
    }

    [Fact]
    public async Task CreateValueAsync_makes_the_first_value_the_default()
    {
        var userId = await CreateUserAsync();
        var state = await CreateStateAsync(userId);

        // Requested as a non-default, but a state with values and no default has no answer for "what
        // is this before anything sets it".
        var result = await _ctx.StateService.CreateValueAsync(
            state.Id, userId, new CreateStateValueRequest("Home"));

        var value = Assert.Single(result.Value!.Values);
        Assert.True(value.IsDefault);
    }

    [Fact]
    public async Task CreateValueAsync_moves_the_default_when_a_later_value_claims_it()
    {
        var userId = await CreateUserAsync();
        var state = await CreateStateAsync(userId);
        await _ctx.StateService.CreateValueAsync(state.Id, userId, new CreateStateValueRequest("Home"));

        var result = await _ctx.StateService.CreateValueAsync(
            state.Id, userId, new CreateStateValueRequest("Work", IsDefault: true));

        Assert.Equal("Work", Assert.Single(result.Value!.Values, v => v.IsDefault).Name);
    }

    [Fact]
    public async Task CreateValueAsync_rejects_a_duration_on_the_default()
    {
        var userId = await CreateUserAsync();
        var state = await CreateStateAsync(userId, "Tired");

        // The default is what an expiring value falls back to, so its own expiry has nowhere to go.
        var result = await _ctx.StateService.CreateValueAsync(
            state.Id, userId, new CreateStateValueRequest("No", DurationMinutes: 60));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
    }

    [Fact]
    public async Task CreateValueAsync_rejects_a_duration_past_the_ceiling()
    {
        var userId = await CreateUserAsync();
        var state = await CreateStateAsync(userId, "Tired");
        await _ctx.StateService.CreateValueAsync(state.Id, userId, new CreateStateValueRequest("No"));

        var result = await _ctx.StateService.CreateValueAsync(
            state.Id, userId,
            new CreateStateValueRequest("Yes", DurationMinutes: StateService.MaxDurationMinutes + 1));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
    }

    [Fact]
    public async Task UpdateValueAsync_refuses_to_clear_the_only_default()
    {
        var userId = await CreateUserAsync();
        var state = await CreateStateAsync(userId);
        var created = await _ctx.StateService.CreateValueAsync(
            state.Id, userId, new CreateStateValueRequest("Home"));
        var home = created.Value!.Values[0];

        var result = await _ctx.StateService.UpdateValueAsync(
            home.Id, state.Id, userId, new UpdateStateValueRequest("Home", IsDefault: false));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
    }

    [Fact]
    public async Task DeleteValueAsync_refuses_while_an_activity_still_requires_it()
    {
        var userId = await CreateUserAsync();
        var state = await CreateStateAsync(userId);
        await _ctx.StateService.CreateValueAsync(state.Id, userId, new CreateStateValueRequest("Home"));
        var withWork = await _ctx.StateService.CreateValueAsync(
            state.Id, userId, new CreateStateValueRequest("Work"));
        var work = withWork.Value!.Values.Single(v => v.Name == "Work");

        var activity = new Activity { UserId = userId, Title = "commute home" };
        _ctx.Db.Activities.Add(activity);
        _ctx.Db.ActivityStateRequirements.Add(new ActivityStateRequirement
        {
            ActivityId = activity.Id,
            StateValueId = work.Id,
        });
        await _ctx.Db.SaveChangesAsync();

        var result = await _ctx.StateService.DeleteValueAsync(work.Id, state.Id, userId);

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Conflict, result.Error!.Type);
    }

    [Fact]
    public async Task DeleteValueAsync_promotes_the_oldest_survivor_when_the_default_goes()
    {
        var userId = await CreateUserAsync();
        var state = await CreateStateAsync(userId);
        var withHome = await _ctx.StateService.CreateValueAsync(
            state.Id, userId, new CreateStateValueRequest("Home"));
        await _ctx.StateService.CreateValueAsync(state.Id, userId, new CreateStateValueRequest("Work"));
        var home = withHome.Value!.Values[0];

        var result = await _ctx.StateService.DeleteValueAsync(home.Id, state.Id, userId);

        Assert.Equal("Work", Assert.Single(result.Value!.Values, v => v.IsDefault).Name);
    }

    [Fact]
    public async Task DeleteAsync_takes_its_values_and_their_references_with_it()
    {
        var userId = await CreateUserAsync();
        var state = await CreateStateAsync(userId);
        var created = await _ctx.StateService.CreateValueAsync(
            state.Id, userId, new CreateStateValueRequest("Home"));
        var home = created.Value!.Values[0];

        // Deleting a whole state is allowed even while in use, in the same spirit as deleting a
        // category: the activity survives, it just stops being gated.
        var activity = new Activity { UserId = userId, Title = "run" };
        _ctx.Db.Activities.Add(activity);
        _ctx.Db.ActivityStateRequirements.Add(new ActivityStateRequirement
        {
            ActivityId = activity.Id,
            StateValueId = home.Id,
        });
        await _ctx.Db.SaveChangesAsync();

        var result = await _ctx.StateService.DeleteAsync(state.Id, userId);

        Assert.True(result.IsSuccess);
        Assert.Empty(await _ctx.StateService.ListAsync(userId));
        Assert.Empty(_ctx.Db.ActivityStateRequirements);
        Assert.NotNull(await _ctx.Db.Activities.FindAsync(activity.Id));
    }

    [Fact]
    public async Task ListAsync_does_not_leak_another_users_states()
    {
        var mine = await CreateUserAsync();
        var theirs = await CreateUserAsync();
        await CreateStateAsync(theirs);

        Assert.Empty(await _ctx.StateService.ListAsync(mine));
    }
}
