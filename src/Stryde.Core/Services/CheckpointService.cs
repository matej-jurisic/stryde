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

        var capError = await ValidateTotalProgressAsync(goalId, req.PlannedProgress, excludeCheckpointId: null);
        if (capError is not null) return Result<CheckpointDto>.Fail(capError);

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

        var capError = await ValidateTotalProgressAsync(goalId, req.PlannedProgress, excludeCheckpointId: id);
        if (capError is not null) return Result<CheckpointDto>.Fail(capError);

        cp.Title = req.Title.Trim();
        cp.PlannedProgress = req.PlannedProgress;
        cp.TargetDate = req.TargetDate;
        await db.SaveChangesAsync();
        return Result<CheckpointDto>.Success(CheckpointDto.FromEntity(cp));
    }

    // Cross-field rule: a goal's checkpoints may not plan more than 100% total progress.
    private async Task<Error?> ValidateTotalProgressAsync(Guid goalId, decimal plannedProgress, Guid? excludeCheckpointId)
    {
        // Sum client-side: SQLite cannot aggregate decimal columns
        var others = await db.Checkpoints
            .Where(c => c.GoalId == goalId && (excludeCheckpointId == null || c.Id != excludeCheckpointId))
            .Select(c => c.PlannedProgress)
            .ToListAsync();
        var total = others.Sum() + plannedProgress;
        if (total > 100)
            return new Error(ErrorType.Validation,
                $"Total planned progress for this goal cannot exceed 100% (this change would make it {total}%).");
        return null;
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
