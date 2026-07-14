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

        var goal = new Goal
        {
            UserId = userId,
            Title = req.Title.Trim(),
            Description = req.Description?.Trim(),
            Notes = req.Notes?.Trim(),
            Kind = req.Kind,
        };
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
        var stats = goal.Kind == GoalKind.ongoing ? await GetOccurrenceStatsAsync([goal.Id], userId) : [];
        return Result<GoalDto>.Success(GoalDto.FromEntity(goal, stats.GetValueOrDefault(goal.Id)));
    }

    public async Task<List<GoalDto>> ListAsync(Guid userId, GoalStatus? status = null)
    {
        var query = db.Goals
            .Include(g => g.Checkpoints)
            .Where(g => g.UserId == userId);

        if (status.HasValue)
            query = query.Where(g => g.Status == status.Value);

        var goals = await query.ToListAsync();

        var ongoingIds = goals.Where(g => g.Kind == GoalKind.ongoing).Select(g => g.Id).ToList();
        var stats = ongoingIds.Count > 0 ? await GetOccurrenceStatsAsync(ongoingIds, userId) : [];

        return goals
            .OrderBy(g => g.Status)
            .ThenBy(g => g.CreatedAt)
            .Select(g => GoalDto.FromEntity(g, stats.GetValueOrDefault(g.Id)))
            .ToList();
    }

    private async Task<Dictionary<Guid, GoalOccurrenceStats>> GetOccurrenceStatsAsync(List<Guid> goalIds, Guid userId)
    {
        var activityGoalMap = await db.Activities
            .Where(a => a.UserId == userId && a.GoalId != null && goalIds.Contains(a.GoalId.Value))
            .Select(a => new { a.Id, GoalId = a.GoalId!.Value })
            .ToListAsync();

        if (activityGoalMap.Count == 0) return [];

        var activityIds = activityGoalMap.Select(a => a.Id).ToList();
        var counts = await db.Occurrences
            .Where(o => activityIds.Contains(o.ActivityId))
            .GroupBy(o => new { o.ActivityId, o.Status })
            .Select(g => new { g.Key.ActivityId, g.Key.Status, Count = g.Count() })
            .ToListAsync();

        var lookup = activityGoalMap.ToDictionary(a => a.Id, a => a.GoalId);
        var result = new Dictionary<Guid, (int Done, int Skipped, int Pending)>();

        foreach (var row in counts)
        {
            var goalId = lookup[row.ActivityId];
            result.TryAdd(goalId, (0, 0, 0));
            var cur = result[goalId];
            result[goalId] = row.Status switch
            {
                EventStatus.done    => cur with { Done    = cur.Done    + row.Count },
                EventStatus.skipped => cur with { Skipped = cur.Skipped + row.Count },
                _                   => cur with { Pending = cur.Pending + row.Count },
            };
        }

        return result.ToDictionary(
            kv => kv.Key,
            kv => new GoalOccurrenceStats(kv.Value.Done, kv.Value.Skipped, kv.Value.Pending));
    }

    public async Task<Result<GoalDto>> UpdateAsync(Guid id, Guid userId, UpdateGoalRequest req)
    {
        var err = Validators.ValidateTitle(req.Title, "Title");
        if (err is not null) return Result<GoalDto>.Fail(err);

        var goal = await db.Goals
            .Include(g => g.Checkpoints)
            .FirstOrDefaultAsync(g => g.Id == id && g.UserId == userId);
        if (goal is null) return Result<GoalDto>.Fail(new Error(ErrorType.NotFound, "Goal not found."));

        goal.Title = req.Title.Trim();
        goal.Description = req.Description?.Trim();
        goal.Notes = req.Notes?.Trim();
        goal.Kind = req.Kind;
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
        var goal = await db.Goals
            .Include(g => g.Checkpoints)
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
