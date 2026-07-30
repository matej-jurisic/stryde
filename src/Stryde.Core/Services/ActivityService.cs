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
            .Include(a => a.Type)
            .Include(a => a.Subtasks)
            .Include(a => a.StateEffects)
            .Include(a => a.StateRequirements)
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
            .Include(a => a.Type)
            .Include(a => a.Subtasks)
            .Include(a => a.StateEffects)
            .Include(a => a.StateRequirements)
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

        if (req.ActivityTypeId.HasValue)
        {
            var type = await db.ActivityTypes.FirstOrDefaultAsync(t => t.Id == req.ActivityTypeId.Value && t.UserId == userId);
            if (type is null) return Result<ActivityDto>.Fail(new Error(ErrorType.NotFound, "Activity type not found."));
            a.ActivityTypeId = type.Id;
            a.Type = type;
        }

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

        var stateErr = await ApplyStatesAsync(a, userId, req.SetsStateValues, req.RequiredStateValueIds);
        if (stateErr is not null) return Result<ActivityDto>.Fail(stateErr);

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
            .Include(a => a.Type)
            .Include(a => a.StateEffects)
            .Include(a => a.StateRequirements)
            .FirstOrDefaultAsync(a => a.Id == id && a.UserId == userId);
        if (a is null) return Result<ActivityDto>.Fail(new Error(ErrorType.NotFound, "Activity not found."));

        a.Title = req.Title.Trim();
        a.ExcludeFromRecommendations = req.ExcludeFromRecommendations;

        if (req.ActivityTypeId.HasValue)
        {
            var type = await db.ActivityTypes.FirstOrDefaultAsync(t => t.Id == req.ActivityTypeId.Value && t.UserId == userId);
            if (type is null) return Result<ActivityDto>.Fail(new Error(ErrorType.NotFound, "Activity type not found."));
            a.ActivityTypeId = type.Id;
            a.Type = type;
        }
        else
        {
            a.ActivityTypeId = null;
            a.Type = null;
        }

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

        var stateErr = await ApplyStatesAsync(a, userId, req.SetsStateValues, req.RequiredStateValueIds);
        if (stateErr is not null) return Result<ActivityDto>.Fail(stateErr);

        await db.SaveChangesAsync();
        return Result<ActivityDto>.Success(ActivityDto.FromEntity(a));
    }

    /// <summary>
    /// Brings the activity's state effects and requirements in line with the request. A null list
    /// means "leave this alone", following <c>OccurrenceService.ApplySubtasks</c>, which matters
    /// because the bulk-assign path resends every field it is not changing.
    /// <para>
    /// Diffed rather than cleared and rebuilt. Both tables key on the row's own contents, so removing
    /// and re-adding an unchanged row would put a Deleted and an Added entity with the same key in the
    /// change tracker at once, which EF refuses.
    /// </para>
    /// </summary>
    private async Task<Error?> ApplyStatesAsync(
        Activity a, Guid userId, List<ActivityStateEffectDto>? sets, List<Guid>? requiredValueIds)
    {
        if (sets is null && requiredValueIds is null) return null;

        var wanted = (sets ?? []).Select(s => s.StateValueId)
            .Concat(requiredValueIds ?? [])
            .Distinct()
            .ToList();

        // Joined through State so one user cannot reference another's value by guessing an id.
        var values = await db.StateValues
            .AsNoTracking()
            .Where(v => wanted.Contains(v.Id) && v.State.UserId == userId)
            .Select(v => new { v.Id, v.StateId, v.IsDefault })
            .ToListAsync();

        if (values.Count != wanted.Count)
            return new Error(ErrorType.NotFound, "State value not found.");

        var valueById = values.ToDictionary(v => v.Id);

        if (sets is not null)
        {
            // Last write per value wins, so a client sending the same value twice with two durations
            // gets one of them rather than a collision.
            var effects = sets
                .GroupBy(s => s.StateValueId)
                .Select(g => g.Last())
                .ToList();

            // Checked before the dictionary is built, not after: two values of one state collide on
            // its key, and the composite key forbidding it at the database is a poor way to say "an
            // activity cannot put Location into two values at once".
            if (effects.Select(e => valueById[e.StateValueId].StateId).Distinct().Count() != effects.Count)
                return new Error(ErrorType.Validation, "An activity can only set one value per state.");

            foreach (var effect in effects)
            {
                var err = Validators.ValidateStateDuration(
                    effect.DurationMinutes, valueById[effect.StateValueId].IsDefault);
                if (err is not null) return err;
            }

            var desired = effects.ToDictionary(e => valueById[e.StateValueId].StateId);

            foreach (var existing in a.StateEffects.ToList())
            {
                if (desired.TryGetValue(existing.StateId, out var effect))
                {
                    // Same state, different value or duration: neither is part of the key, so this is
                    // an in-place update and no row churns.
                    existing.StateValueId = effect.StateValueId;
                    existing.DurationMinutes = effect.DurationMinutes;
                    desired.Remove(existing.StateId);
                }
                else
                {
                    a.StateEffects.Remove(existing);
                    db.ActivityStateEffects.Remove(existing);
                }
            }

            foreach (var (stateId, effect) in desired)
                a.StateEffects.Add(new ActivityStateEffect
                {
                    ActivityId = a.Id,
                    StateId = stateId,
                    StateValueId = effect.StateValueId,
                    DurationMinutes = effect.DurationMinutes,
                });
        }

        if (requiredValueIds is not null)
        {
            var desired = requiredValueIds.Distinct().ToHashSet();

            foreach (var existing in a.StateRequirements.ToList())
            {
                if (desired.Contains(existing.StateValueId))
                {
                    desired.Remove(existing.StateValueId);
                }
                else
                {
                    a.StateRequirements.Remove(existing);
                    db.ActivityStateRequirements.Remove(existing);
                }
            }

            foreach (var valueId in desired)
                a.StateRequirements.Add(new ActivityStateRequirement
                {
                    ActivityId = a.Id,
                    StateValueId = valueId,
                });
        }

        return null;
    }

    public async Task<Result<ActivityDto>> SetRecommendationsAsync(Guid id, Guid userId, SetActivityRecommendationsRequest req)
    {
        var a = await db.Activities
            .Include(a => a.Category)
            .Include(a => a.Goal)
            .Include(a => a.Type)
            .Include(a => a.Subtasks)
            .Include(a => a.StateEffects)
            .Include(a => a.StateRequirements)
            .FirstOrDefaultAsync(a => a.Id == id && a.UserId == userId);
        if (a is null) return Result<ActivityDto>.Fail(new Error(ErrorType.NotFound, "Activity not found."));

        a.ExcludeFromRecommendations = req.ExcludeFromRecommendations;
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
