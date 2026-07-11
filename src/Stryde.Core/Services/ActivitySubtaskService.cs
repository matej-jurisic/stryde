using Microsoft.EntityFrameworkCore;
using Stryde.Core.Common;
using Stryde.Core.Data;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;

namespace Stryde.Core.Services;

public class ActivitySubtaskService(StrydeDbContext db)
{
    public async Task<Result<ActivitySubtaskDto>> CreateAsync(Guid activityId, Guid userId, CreateActivitySubtaskRequest req)
    {
        var err = Validators.ValidateTitle(req.Title, "Title");
        if (err is not null) return Result<ActivitySubtaskDto>.Fail(err);

        var activity = await db.Activities.FirstOrDefaultAsync(a => a.Id == activityId && a.UserId == userId);
        if (activity is null) return Result<ActivitySubtaskDto>.Fail(new Error(ErrorType.NotFound, "Activity not found."));

        var subtask = new ActivitySubtask { ActivityId = activityId, Title = req.Title.Trim() };
        db.ActivitySubtasks.Add(subtask);
        await db.SaveChangesAsync();
        return Result<ActivitySubtaskDto>.Success(ActivitySubtaskDto.FromEntity(subtask));
    }

    public async Task<Result<ActivitySubtaskDto>> UpdateAsync(Guid id, Guid activityId, Guid userId, UpdateActivitySubtaskRequest req)
    {
        var err = Validators.ValidateTitle(req.Title, "Title");
        if (err is not null) return Result<ActivitySubtaskDto>.Fail(err);

        var subtask = await db.ActivitySubtasks
            .Include(s => s.Activity)
            .FirstOrDefaultAsync(s => s.Id == id && s.ActivityId == activityId && s.Activity.UserId == userId);
        if (subtask is null) return Result<ActivitySubtaskDto>.Fail(new Error(ErrorType.NotFound, "Subtask not found."));

        subtask.Title = req.Title.Trim();
        await db.SaveChangesAsync();
        return Result<ActivitySubtaskDto>.Success(ActivitySubtaskDto.FromEntity(subtask));
    }

    public async Task<Result> DeleteAsync(Guid id, Guid activityId, Guid userId)
    {
        var subtask = await db.ActivitySubtasks
            .Include(s => s.Activity)
            .FirstOrDefaultAsync(s => s.Id == id && s.ActivityId == activityId && s.Activity.UserId == userId);
        if (subtask is null) return Result.Fail(new Error(ErrorType.NotFound, "Subtask not found."));

        db.ActivitySubtasks.Remove(subtask);
        await db.SaveChangesAsync();
        return Result.Success();
    }
}
