using Microsoft.EntityFrameworkCore;
using Stryde.Core.Common;
using Stryde.Core.Data;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;
using Stryde.Core.Enums;

namespace Stryde.Core.Services;

public class GoalService(StrydeDbContext db, UserSettingsService settingsService)
{
    public async Task<Result<GoalDto>> CreateAsync(Guid userId, CreateGoalRequest req)
    {
        var err = Validators.ValidateTitle(req.Title, "Title");
        if (err is not null) return Result<GoalDto>.Fail(err);

        var goal = new Goal { UserId = userId, Title = req.Title.Trim(), Description = req.Description?.Trim() };
        db.Goals.Add(goal);
        await db.SaveChangesAsync();
        return Result<GoalDto>.Success(GoalDto.FromEntity(goal));
    }

    public async Task<Result<GoalDto>> GetAsync(Guid id, Guid userId)
    {
        var goal = await db.Goals
            .Include(g => g.Checkpoints)
            .FirstOrDefaultAsync(g => g.Id == id && g.UserId == userId);
        if (goal is null) return Result<GoalDto>.Fail(new Error(ErrorType.NotFound, "Goal not found."));
        return Result<GoalDto>.Success(GoalDto.FromEntity(goal));
    }

    public async Task<List<GoalDto>> ListAsync(Guid userId, GoalStatus? status = null)
    {
        var query = db.Goals
            .Include(g => g.Checkpoints)
            .Where(g => g.UserId == userId);

        if (status.HasValue)
            query = query.Where(g => g.Status == status.Value);

        var goals = await query.ToListAsync();
        return goals
            .OrderBy(g => g.Status)
            .ThenBy(g => g.CreatedAt)
            .Select(GoalDto.FromEntity)
            .ToList();
    }

    public async Task<Result<GoalDto>> UpdateAsync(Guid id, Guid userId, UpdateGoalRequest req)
    {
        var err = Validators.ValidateTitle(req.Title, "Title");
        if (err is not null) return Result<GoalDto>.Fail(err);

        var goal = await db.Goals.Include(g => g.Checkpoints)
            .FirstOrDefaultAsync(g => g.Id == id && g.UserId == userId);
        if (goal is null) return Result<GoalDto>.Fail(new Error(ErrorType.NotFound, "Goal not found."));

        goal.Title = req.Title.Trim();
        goal.Description = req.Description?.Trim();
        await db.SaveChangesAsync();
        return Result<GoalDto>.Success(GoalDto.FromEntity(goal));
    }

    public async Task<Result> DeleteAsync(Guid id, Guid userId)
    {
        var goal = await db.Goals.FirstOrDefaultAsync(g => g.Id == id && g.UserId == userId);
        if (goal is null) return Result.Fail(new Error(ErrorType.NotFound, "Goal not found."));
        db.Goals.Remove(goal);
        await db.SaveChangesAsync();
        return Result.Success();
    }

    public async Task<Result<GoalDto>> SetStatusAsync(Guid id, Guid userId, GoalStatus status)
    {
        var goal = await db.Goals.Include(g => g.Checkpoints)
            .FirstOrDefaultAsync(g => g.Id == id && g.UserId == userId);
        if (goal is null) return Result<GoalDto>.Fail(new Error(ErrorType.NotFound, "Goal not found."));

        if (status == GoalStatus.focus && goal.Status != GoalStatus.focus)
        {
            var settings = await settingsService.GetOrCreateAsync(userId);
            var focusCount = await db.Goals.CountAsync(g => g.UserId == userId && g.Status == GoalStatus.focus);
            if (focusCount >= settings.MaxFocusGoals)
                return Result<GoalDto>.Fail(new Error(ErrorType.Conflict,
                    $"Focus limit reached ({settings.MaxFocusGoals}). Move another goal out of Focus first."));
        }

        goal.Status = status;
        await db.SaveChangesAsync();
        return Result<GoalDto>.Success(GoalDto.FromEntity(goal));
    }
}
