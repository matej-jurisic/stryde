using Stryde.Core.Common;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;

namespace Stryde.Tests.Unit;

public class CheckpointServiceTests : IDisposable
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
        var goal = new Goal { UserId = user.Id, Title = "Goal" };
        _ctx.Db.Users.Add(user);
        _ctx.Db.Goals.Add(goal);
        await _ctx.Db.SaveChangesAsync();
        return (user.Id, goal.Id);
    }

    [Fact]
    public async Task CreateAsync_rejects_total_planned_progress_over_100()
    {
        var (userId, goalId) = await CreateUserWithGoalAsync();
        await _ctx.CheckpointService.CreateAsync(goalId, userId, new CreateCheckpointRequest("First", 60, null));

        var result = await _ctx.CheckpointService.CreateAsync(goalId, userId, new CreateCheckpointRequest("Second", 50, null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
    }

    [Fact]
    public async Task CreateAsync_allows_total_of_exactly_100()
    {
        var (userId, goalId) = await CreateUserWithGoalAsync();
        await _ctx.CheckpointService.CreateAsync(goalId, userId, new CreateCheckpointRequest("First", 60, null));

        var result = await _ctx.CheckpointService.CreateAsync(goalId, userId, new CreateCheckpointRequest("Second", 40, null));

        Assert.True(result.IsSuccess);
    }

    [Fact]
    public async Task UpdateAsync_excludes_own_value_from_the_cap()
    {
        var (userId, goalId) = await CreateUserWithGoalAsync();
        var first = (await _ctx.CheckpointService.CreateAsync(goalId, userId, new CreateCheckpointRequest("First", 60, null))).Value!;
        await _ctx.CheckpointService.CreateAsync(goalId, userId, new CreateCheckpointRequest("Second", 40, null));

        // Re-saving at the same value stays at 100 total and must pass
        var same = await _ctx.CheckpointService.UpdateAsync(first.Id, goalId, userId, new UpdateCheckpointRequest("First", 60, null));
        Assert.True(same.IsSuccess);

        // Raising it would push the total to 101 and must fail
        var over = await _ctx.CheckpointService.UpdateAsync(first.Id, goalId, userId, new UpdateCheckpointRequest("First", 61, null));
        Assert.False(over.IsSuccess);
        Assert.Equal(ErrorType.Validation, over.Error!.Type);
    }
}
