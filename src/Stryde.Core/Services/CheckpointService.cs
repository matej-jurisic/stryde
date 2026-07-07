using Microsoft.EntityFrameworkCore;
using Stryde.Core.Common;
using Stryde.Core.Data;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;
using Stryde.Core.Enums;

namespace Stryde.Core.Services;

public class CheckpointService(StrydeDbContext db)
{
    public async Task<Result<CheckpointDto>> CreateAsync(Guid goalId, Guid userId, CreateCheckpointRequest req)
    {
        var err = Validators.ValidateTitle(req.Title, "Title")
            ?? Validators.ValidatePlannedProgress(req.PlannedProgress);
        if (err is not null) return Result<CheckpointDto>.Fail(err);

        var goal = await db.Goals.FirstOrDefaultAsync(g => g.Id == goalId && g.UserId == userId);
        if (goal is null) return Result<CheckpointDto>.Fail(new Error(ErrorType.NotFound, "Goal not found."));

        var cp = new Checkpoint
        {
            GoalId = goalId,
            Title = req.Title.Trim(),
            PlannedProgress = req.PlannedProgress,
            TargetDate = req.TargetDate,
        };
        db.Checkpoints.Add(cp);
        await db.SaveChangesAsync();
        return Result<CheckpointDto>.Success(CheckpointDto.FromEntity(cp));
    }

    public async Task<Result<CheckpointDto>> GetAsync(Guid id, Guid goalId, Guid userId)
    {
        var cp = await db.Checkpoints
            .Include(c => c.Goal)
            .FirstOrDefaultAsync(c => c.Id == id && c.GoalId == goalId && c.Goal.UserId == userId);
        if (cp is null) return Result<CheckpointDto>.Fail(new Error(ErrorType.NotFound, "Checkpoint not found."));
        return Result<CheckpointDto>.Success(CheckpointDto.FromEntity(cp));
    }

    public async Task<List<CheckpointDto>> ListAsync(Guid goalId, Guid userId)
    {
        var goal = await db.Goals.FirstOrDefaultAsync(g => g.Id == goalId && g.UserId == userId);
        if (goal is null) return [];

        var cps = await db.Checkpoints.Where(c => c.GoalId == goalId).ToListAsync();
        return cps.OrderBy(c => c.CreatedAt).Select(CheckpointDto.FromEntity).ToList();
    }

    public async Task<Result<CheckpointDto>> UpdateAsync(Guid id, Guid goalId, Guid userId, UpdateCheckpointRequest req)
    {
        var err = Validators.ValidateTitle(req.Title, "Title")
            ?? Validators.ValidatePlannedProgress(req.PlannedProgress);
        if (err is not null) return Result<CheckpointDto>.Fail(err);

        var cp = await db.Checkpoints
            .Include(c => c.Goal)
            .FirstOrDefaultAsync(c => c.Id == id && c.GoalId == goalId && c.Goal.UserId == userId);
        if (cp is null) return Result<CheckpointDto>.Fail(new Error(ErrorType.NotFound, "Checkpoint not found."));

        cp.Title = req.Title.Trim();
        cp.PlannedProgress = req.PlannedProgress;
        cp.TargetDate = req.TargetDate;
        await db.SaveChangesAsync();
        return Result<CheckpointDto>.Success(CheckpointDto.FromEntity(cp));
    }

    public async Task<Result> DeleteAsync(Guid id, Guid goalId, Guid userId)
    {
        var cp = await db.Checkpoints
            .Include(c => c.Goal)
            .FirstOrDefaultAsync(c => c.Id == id && c.GoalId == goalId && c.Goal.UserId == userId);
        if (cp is null) return Result.Fail(new Error(ErrorType.NotFound, "Checkpoint not found."));
        db.Checkpoints.Remove(cp);
        await db.SaveChangesAsync();
        return Result.Success();
    }

    public async Task<Result<CheckpointDto>> SetStatusAsync(Guid id, Guid goalId, Guid userId, CheckpointStatus status)
    {
        var cp = await db.Checkpoints
            .Include(c => c.Goal)
            .FirstOrDefaultAsync(c => c.Id == id && c.GoalId == goalId && c.Goal.UserId == userId);
        if (cp is null) return Result<CheckpointDto>.Fail(new Error(ErrorType.NotFound, "Checkpoint not found."));
        cp.Status = status;
        await db.SaveChangesAsync();
        return Result<CheckpointDto>.Success(CheckpointDto.FromEntity(cp));
    }
}
