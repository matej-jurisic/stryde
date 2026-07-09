using Stryde.Core.Common;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;
using Stryde.Core.Enums;

namespace Stryde.Tests.Unit;

public class BaseEventServiceTests : IDisposable
{
    private readonly TestContext _ctx = new();

    public void Dispose() => _ctx.Dispose();

    private async Task<(Guid userId, Guid goalId)> CreateUserWithGoalAsync()
    {
        var user = new User
        {
            Username = "u" + Guid.NewGuid().ToString("N")[..8],
            PasswordHash = "x",
            Timezone = "UTC",
        };
        var goal = new Goal { UserId = user.Id, Title = "My Goal" };
        _ctx.Db.Users.Add(user);
        _ctx.Db.Goals.Add(goal);
        await _ctx.Db.SaveChangesAsync();
        return (user.Id, goal.Id);
    }

    [Fact]
    public async Task CreateAsync_returns_base_event()
    {
        var (userId, goalId) = await CreateUserWithGoalAsync();

        var result = await _ctx.BaseEventService.CreateAsync(goalId, userId, new CreateBaseEventRequest("Morning run", null));

        Assert.True(result.IsSuccess);
        Assert.Equal("Morning run", result.Value!.Title);
        Assert.Equal(goalId, result.Value.GoalId);
    }

    [Fact]
    public async Task CreateAsync_unknown_goal_returns_not_found()
    {
        var (userId, _) = await CreateUserWithGoalAsync();

        var result = await _ctx.BaseEventService.CreateAsync(Guid.NewGuid(), userId, new CreateBaseEventRequest("Task", null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.NotFound, result.Error!.Type);
    }

    [Fact]
    public async Task CreateAsync_empty_title_returns_validation_error()
    {
        var (userId, goalId) = await CreateUserWithGoalAsync();

        var result = await _ctx.BaseEventService.CreateAsync(goalId, userId, new CreateBaseEventRequest("  ", null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
    }

    [Fact]
    public async Task UpdateAsync_changes_title()
    {
        var (userId, goalId) = await CreateUserWithGoalAsync();
        var created = (await _ctx.BaseEventService.CreateAsync(goalId, userId, new CreateBaseEventRequest("Old title", null))).Value!;

        var result = await _ctx.BaseEventService.UpdateAsync(created.Id, userId, new UpdateBaseEventRequest("New title", null));

        Assert.True(result.IsSuccess);
        Assert.Equal("New title", result.Value!.Title);
    }

    [Fact]
    public async Task UpdateAsync_unknown_returns_not_found()
    {
        var (userId, _) = await CreateUserWithGoalAsync();

        var result = await _ctx.BaseEventService.UpdateAsync(Guid.NewGuid(), userId, new UpdateBaseEventRequest("X", null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.NotFound, result.Error!.Type);
    }

    [Fact]
    public async Task DeleteAsync_removes_base_event()
    {
        var (userId, goalId) = await CreateUserWithGoalAsync();
        var created = (await _ctx.BaseEventService.CreateAsync(goalId, userId, new CreateBaseEventRequest("To delete", null))).Value!;

        var deleteResult = await _ctx.BaseEventService.DeleteAsync(created.Id, userId);
        var remaining = await _ctx.BaseEventService.ListByGoalAsync(goalId, userId);

        Assert.True(deleteResult.IsSuccess);
        Assert.Empty(remaining);
    }

    [Fact]
    public async Task DeleteAsync_unknown_returns_not_found()
    {
        var (userId, _) = await CreateUserWithGoalAsync();

        var result = await _ctx.BaseEventService.DeleteAsync(Guid.NewGuid(), userId);

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.NotFound, result.Error!.Type);
    }

    [Fact]
    public async Task ListByGoalAsync_scoped_to_goal()
    {
        var (userId, goal1Id) = await CreateUserWithGoalAsync();
        var goal2 = new Goal { UserId = userId, Title = "Goal 2" };
        _ctx.Db.Goals.Add(goal2);
        await _ctx.Db.SaveChangesAsync();

        await _ctx.BaseEventService.CreateAsync(goal1Id, userId, new CreateBaseEventRequest("Template A", null));
        await _ctx.BaseEventService.CreateAsync(goal1Id, userId, new CreateBaseEventRequest("Template B", null));
        await _ctx.BaseEventService.CreateAsync(goal2.Id, userId, new CreateBaseEventRequest("Template C", null));

        var list = await _ctx.BaseEventService.ListByGoalAsync(goal1Id, userId);

        Assert.Equal(2, list.Count);
        Assert.All(list, b => Assert.Equal(goal1Id, b.GoalId));
    }
}
