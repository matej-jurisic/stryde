using Microsoft.EntityFrameworkCore;
using Stryde.Core.Common;
using Stryde.Core.Data;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;

namespace Stryde.Core.Services;

public class BaseEventService(StrydeDbContext db)
{
    public async Task<List<BaseEventSummaryDto>> ListByGoalAsync(Guid goalId, Guid userId)
    {
        var results = await db.BaseEvents
            .Include(b => b.Category)
            .Include(b => b.Goal)
            .Where(b => b.GoalId == goalId && b.UserId == userId)
            .OrderBy(b => b.Title)
            .ToListAsync();
        return results.Select(BaseEventSummaryDto.FromEntity).ToList();
    }

    public async Task<Result<BaseEventSummaryDto>> CreateAsync(Guid goalId, Guid userId, CreateBaseEventRequest req)
    {
        var err = Validators.ValidateTitle(req.Title, "Title");
        if (err is not null) return Result<BaseEventSummaryDto>.Fail(err);

        var goal = await db.Goals.FirstOrDefaultAsync(g => g.Id == goalId && g.UserId == userId);
        if (goal is null) return Result<BaseEventSummaryDto>.Fail(new Error(ErrorType.NotFound, "Goal not found."));

        var be = new BaseEvent { UserId = userId, GoalId = goalId, Title = req.Title.Trim(), Goal = goal };

        if (req.CategoryId.HasValue)
        {
            var cat = await db.Categories.FirstOrDefaultAsync(c => c.Id == req.CategoryId.Value && c.UserId == userId);
            if (cat is null) return Result<BaseEventSummaryDto>.Fail(new Error(ErrorType.NotFound, "Category not found."));
            be.CategoryId = req.CategoryId.Value;
            be.Category = cat;
        }

        db.BaseEvents.Add(be);
        await db.SaveChangesAsync();
        return Result<BaseEventSummaryDto>.Success(BaseEventSummaryDto.FromEntity(be));
    }

    public async Task<Result<BaseEventSummaryDto>> UpdateAsync(Guid id, Guid userId, UpdateBaseEventRequest req)
    {
        var err = Validators.ValidateTitle(req.Title, "Title");
        if (err is not null) return Result<BaseEventSummaryDto>.Fail(err);

        var be = await db.BaseEvents
            .Include(b => b.Category)
            .Include(b => b.Goal)
            .FirstOrDefaultAsync(b => b.Id == id && b.UserId == userId);
        if (be is null) return Result<BaseEventSummaryDto>.Fail(new Error(ErrorType.NotFound, "Base event not found."));

        be.Title = req.Title.Trim();

        if (req.CategoryId.HasValue)
        {
            var cat = await db.Categories.FirstOrDefaultAsync(c => c.Id == req.CategoryId.Value && c.UserId == userId);
            if (cat is null) return Result<BaseEventSummaryDto>.Fail(new Error(ErrorType.NotFound, "Category not found."));
            be.CategoryId = req.CategoryId.Value;
            be.Category = cat;
        }
        else
        {
            be.CategoryId = null;
            be.Category = null;
        }

        await db.SaveChangesAsync();
        return Result<BaseEventSummaryDto>.Success(BaseEventSummaryDto.FromEntity(be));
    }

    public async Task<Result> DeleteAsync(Guid id, Guid userId)
    {
        var be = await db.BaseEvents.FirstOrDefaultAsync(b => b.Id == id && b.UserId == userId);
        if (be is null) return Result.Fail(new Error(ErrorType.NotFound, "Base event not found."));
        db.BaseEvents.Remove(be);
        await db.SaveChangesAsync();
        return Result.Success();
    }
}
