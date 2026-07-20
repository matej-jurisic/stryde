using Microsoft.EntityFrameworkCore;
using Stryde.Core.Common;
using Stryde.Core.Data;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;
using Stryde.Core.Enums;

namespace Stryde.Core.Services;

public class ActivityService(StrydeDbContext db)
{
    public async Task<Result<ActivityDto>> GetAsync(Guid id, Guid userId)
    {
        var a = await db.Activities
            .Include(a => a.Category)
            .Include(a => a.Goal)
            .Include(a => a.Subtasks)
            .FirstOrDefaultAsync(a => a.Id == id && a.UserId == userId);
        return a is null
            ? Result<ActivityDto>.Fail(new Error(ErrorType.NotFound, "Activity not found."))
            : Result<ActivityDto>.Success(ActivityDto.FromEntity(a));
    }

    public async Task<List<ActivityDto>> ListAsync(Guid userId, Guid? goalId = null)
    {
        var query = db.Activities
            .Include(a => a.Category)
            .Include(a => a.Goal)
            .Include(a => a.Subtasks)
            .Where(a => a.UserId == userId && a.Kind == ActivityKind.activity);

        if (goalId.HasValue)
            query = query.Where(a => a.GoalId == goalId.Value);

        var all = await query.OrderBy(a => a.Title).ToListAsync();
        return all.Select(ActivityDto.FromEntity).ToList();
    }

    public async Task<Result<ActivityDto>> CreateAsync(Guid userId, CreateActivityRequest req)
    {
        var err = Validators.ValidateTitle(req.Title, "Title");
        if (err is not null) return Result<ActivityDto>.Fail(err);

        var a = new Activity { UserId = userId, Title = req.Title.Trim() };

        if (req.CategoryId.HasValue)
        {
            var cat = await db.Categories.FirstOrDefaultAsync(c => c.Id == req.CategoryId.Value && c.UserId == userId);
            if (cat is null) return Result<ActivityDto>.Fail(new Error(ErrorType.NotFound, "Category not found."));
            a.CategoryId = req.CategoryId.Value;
            a.Category = cat;
        }

        if (req.GoalId.HasValue)
        {
            var goal = await db.Goals.FirstOrDefaultAsync(g => g.Id == req.GoalId.Value && g.UserId == userId);
            if (goal is null) return Result<ActivityDto>.Fail(new Error(ErrorType.NotFound, "Goal not found."));
            a.GoalId = req.GoalId.Value;
            a.Goal = goal;
        }

        db.Activities.Add(a);
        await db.SaveChangesAsync();
        return Result<ActivityDto>.Success(ActivityDto.FromEntity(a));
    }

    public async Task<Result<ActivityDto>> UpdateAsync(Guid id, Guid userId, UpdateActivityRequest req)
    {
        var err = Validators.ValidateTitle(req.Title, "Title");
        if (err is not null) return Result<ActivityDto>.Fail(err);

        var a = await db.Activities
            .Include(a => a.Category)
            .Include(a => a.Goal)
            .FirstOrDefaultAsync(a => a.Id == id && a.UserId == userId);
        if (a is null) return Result<ActivityDto>.Fail(new Error(ErrorType.NotFound, "Activity not found."));

        a.Title = req.Title.Trim();
        a.ExcludeFromRecommendations = req.ExcludeFromRecommendations;

        if (req.CategoryId.HasValue)
        {
            var cat = await db.Categories.FirstOrDefaultAsync(c => c.Id == req.CategoryId.Value && c.UserId == userId);
            if (cat is null) return Result<ActivityDto>.Fail(new Error(ErrorType.NotFound, "Category not found."));
            a.CategoryId = req.CategoryId.Value;
            a.Category = cat;
        }
        else
        {
            a.CategoryId = null;
            a.Category = null;
        }

        if (req.GoalId.HasValue)
        {
            var goal = await db.Goals.FirstOrDefaultAsync(g => g.Id == req.GoalId.Value && g.UserId == userId);
            if (goal is null) return Result<ActivityDto>.Fail(new Error(ErrorType.NotFound, "Goal not found."));
            a.GoalId = req.GoalId.Value;
            a.Goal = goal;
        }
        else
        {
            a.GoalId = null;
            a.Goal = null;
        }

        await db.SaveChangesAsync();
        return Result<ActivityDto>.Success(ActivityDto.FromEntity(a));
    }

    public async Task<Result> DeleteAsync(Guid id, Guid userId)
    {
        var a = await db.Activities.FirstOrDefaultAsync(a => a.Id == id && a.UserId == userId);
        if (a is null) return Result.Fail(new Error(ErrorType.NotFound, "Activity not found."));
        db.Activities.Remove(a);
        await db.SaveChangesAsync();
        return Result.Success();
    }
}
