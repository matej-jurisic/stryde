using Stryde.Core.Common;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;
using Stryde.Core.Enums;

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
    public async Task CreateAsync_defaults_to_normal_size()
    {
        var (userId, goalId) = await CreateUserWithGoalAsync();

        var result = await _ctx.CheckpointService.CreateAsync(goalId, userId,
            new CreateCheckpointRequest("Learn a scale", CheckpointSize.normal, null));

        Assert.True(result.IsSuccess);
        Assert.Equal("normal", result.Value!.Size);
    }

    [Fact]
    public async Task CreateAsync_stores_specified_size()
    {
        var (userId, goalId) = await CreateUserWithGoalAsync();

        var result = await _ctx.CheckpointService.CreateAsync(goalId, userId,
            new CreateCheckpointRequest("Learn first full song", CheckpointSize.huge, null));

        Assert.True(result.IsSuccess);
        Assert.Equal("huge", result.Value!.Size);
    }

    [Fact]
    public async Task UpdateAsync_changes_size()
    {
        var (userId, goalId) = await CreateUserWithGoalAsync();
        var created = (await _ctx.CheckpointService.CreateAsync(goalId, userId,
            new CreateCheckpointRequest("Learn a scale", CheckpointSize.small, null))).Value!;

        var updated = await _ctx.CheckpointService.UpdateAsync(created.Id, goalId, userId,
            new UpdateCheckpointRequest("Learn a scale", CheckpointSize.big, null));

        Assert.True(updated.IsSuccess);
        Assert.Equal("big", updated.Value!.Size);
    }

    [Fact]
    public async Task CreateAsync_allows_any_number_of_checkpoints()
    {
        var (userId, goalId) = await CreateUserWithGoalAsync();

        for (var i = 0; i < 5; i++)
        {
            var r = await _ctx.CheckpointService.CreateAsync(goalId, userId,
                new CreateCheckpointRequest($"Step {i}", CheckpointSize.huge, null));
            Assert.True(r.IsSuccess);
        }
    }
}
