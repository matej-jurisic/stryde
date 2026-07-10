using Stryde.Core.Common;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;

namespace Stryde.Tests.Unit;

public class ActivityServiceTests : IDisposable
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
    public async Task CreateAsync_returns_activity()
    {
        var (userId, goalId) = await CreateUserWithGoalAsync();

        var result = await _ctx.ActivityService.CreateAsync(userId, new CreateActivityRequest("Morning run", null, goalId));

        Assert.True(result.IsSuccess);
        Assert.Equal("Morning run", result.Value!.Title);
        Assert.Equal(goalId, result.Value.GoalId);
    }

    [Fact]
    public async Task CreateAsync_unknown_goal_returns_not_found()
    {
        var (userId, _) = await CreateUserWithGoalAsync();

        var result = await _ctx.ActivityService.CreateAsync(userId, new CreateActivityRequest("Task", null, Guid.NewGuid()));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.NotFound, result.Error!.Type);
    }

    [Fact]
    public async Task CreateAsync_empty_title_returns_validation_error()
    {
        var (userId, goalId) = await CreateUserWithGoalAsync();

        var result = await _ctx.ActivityService.CreateAsync(userId, new CreateActivityRequest("  ", null, goalId));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
    }

    [Fact]
    public async Task UpdateAsync_changes_title()
    {
        var (userId, goalId) = await CreateUserWithGoalAsync();
        var created = (await _ctx.ActivityService.CreateAsync(userId, new CreateActivityRequest("Old title", null, goalId))).Value!;

        var result = await _ctx.ActivityService.UpdateAsync(created.Id, userId, new UpdateActivityRequest("New title", null, goalId));

        Assert.True(result.IsSuccess);
        Assert.Equal("New title", result.Value!.Title);
    }

    [Fact]
    public async Task UpdateAsync_unknown_returns_not_found()
    {
        var (userId, goalId) = await CreateUserWithGoalAsync();

        var result = await _ctx.ActivityService.UpdateAsync(Guid.NewGuid(), userId, new UpdateActivityRequest("X", null, goalId));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.NotFound, result.Error!.Type);
    }

    [Fact]
    public async Task DeleteAsync_removes_activity()
    {
        var (userId, goalId) = await CreateUserWithGoalAsync();
        var created = (await _ctx.ActivityService.CreateAsync(userId, new CreateActivityRequest("To delete", null, goalId))).Value!;

        var deleteResult = await _ctx.ActivityService.DeleteAsync(created.Id, userId);
        var remaining = await _ctx.ActivityService.ListAsync(userId, goalId);

        Assert.True(deleteResult.IsSuccess);
        Assert.Empty(remaining);
    }

    [Fact]
    public async Task DeleteAsync_unknown_returns_not_found()
    {
        var (userId, _) = await CreateUserWithGoalAsync();

        var result = await _ctx.ActivityService.DeleteAsync(Guid.NewGuid(), userId);

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.NotFound, result.Error!.Type);
    }

    [Fact]
    public async Task ListAsync_filtered_by_goal()
    {
        var (userId, goal1Id) = await CreateUserWithGoalAsync();
        var goal2 = new Goal { UserId = userId, Title = "Goal 2" };
        _ctx.Db.Goals.Add(goal2);
        await _ctx.Db.SaveChangesAsync();

        await _ctx.ActivityService.CreateAsync(userId, new CreateActivityRequest("Activity A", null, goal1Id));
        await _ctx.ActivityService.CreateAsync(userId, new CreateActivityRequest("Activity B", null, goal1Id));
        await _ctx.ActivityService.CreateAsync(userId, new CreateActivityRequest("Activity C", null, goal2.Id));

        var list = await _ctx.ActivityService.ListAsync(userId, goal1Id);

        Assert.Equal(2, list.Count);
        Assert.All(list, a => Assert.Equal(goal1Id, a.GoalId));
    }
}
