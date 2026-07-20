using Microsoft.EntityFrameworkCore;
using Stryde.Core.Common;
using Stryde.Core.Data;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;
using Stryde.Core.Enums;

namespace Stryde.Core.Services;

public class OccurrenceService(StrydeDbContext db, UserSettingsService settings)
{
    public async Task<Result<OccurrenceDto>> CreateAsync(Guid userId, CreateOccurrenceRequest req)
    {
        var err = ValidateOptionalTitle(req.Title)
            ?? ValidateWindowAndStartAt(req.StartAt, req.WindowStart)
            ?? Validators.ValidateDateRange(req.StartAt, req.EndAt)
            ?? ValidateDuration(req.IsPlanned, req.StartAt, req.EndAt, req.DurationMinutes);
        if (err is not null) return Result<OccurrenceDto>.Fail(err);

        var activity = await db.Activities
            .Include(a => a.Category)
            .Include(a => a.Goal)
            .Include(a => a.Subtasks)
            .FirstOrDefaultAsync(a => a.Id == req.ActivityId && a.UserId == userId);
        if (activity is null) return Result<OccurrenceDto>.Fail(new Error(ErrorType.NotFound, "Activity not found."));

        var o = new Occurrence
        {
            UserId = userId,
            ActivityId = activity.Id,
            Activity = activity,
            Title = string.IsNullOrWhiteSpace(req.Title) ? null : req.Title.Trim(),
            StartAt = req.StartAt,
            EndAt = req.EndAt,
            IsAllDay = req.IsAllDay,
            IsPlanned = req.IsPlanned,
            DurationMinutes = req.DurationMinutes,
            WindowStart = req.WindowStart,
            WindowEnd = req.WindowEnd,
            WindowDurationMinutes = req.WindowDurationMinutes,
        };

        var subtaskCopies = activity.Subtasks
            .OrderBy(s => s.CreatedAt)
            .Select(s => new OccurrenceSubtask { OccurrenceId = o.Id, Title = s.Title })
            .ToList();

        db.Occurrences.Add(o);
        db.OccurrenceSubtasks.AddRange(subtaskCopies);
        o.Subtasks = subtaskCopies;

        await db.SaveChangesAsync();
        return Result<OccurrenceDto>.Success(await ToDtoAsync(o, userId));
    }

    public async Task<Result<OccurrenceDto>> GetAsync(Guid id, Guid userId)
    {
        var o = await WithFullIncludes()
            .FirstOrDefaultAsync(o => o.Id == id && o.UserId == userId);
        if (o is null) return Result<OccurrenceDto>.Fail(new Error(ErrorType.NotFound, "Occurrence not found."));
        return Result<OccurrenceDto>.Success(await ToDtoAsync(o, userId));
    }

    public async Task<List<OccurrenceDto>> ListAsync(
        Guid userId,
        EventStatus? status = null,
        DateTimeOffset? startFrom = null,
        DateTimeOffset? endBefore = null,
        bool floatingOnly = false,
        Guid? goalId = null,
        Guid? activityId = null)
    {
        var query = WithFullIncludes()
            .Where(o => o.UserId == userId);

        if (status.HasValue) query = query.Where(o => o.Status == status.Value);
        if (floatingOnly) query = query.Where(o => o.StartAt == null && o.EndAt == null && o.WindowStart == null && !o.IsAllDay
            && (o.Activity.GoalId == null || o.Activity.Goal!.Status != GoalStatus.bench));
        if (goalId.HasValue) query = query.Where(o => o.Activity.GoalId == goalId.Value);
        if (activityId.HasValue) query = query.Where(o => o.ActivityId == activityId.Value);

        var all = await query.ToListAsync();

        IEnumerable<Occurrence> occurrences = all;
        if (startFrom.HasValue || endBefore.HasValue)
        {
            occurrences = occurrences.Where(o =>
            {
                if (o.WindowStart is not null)
                {
                    var wStart = o.WindowStart.Value;
                    var wEnd = o.WindowEnd ?? o.WindowStart.Value;
                    return (!endBefore.HasValue || wStart < endBefore.Value)
                        && (!startFrom.HasValue || wEnd > startFrom.Value);
                }
                if (o.StartAt is not null && o.EndAt is not null)
                    return (!endBefore.HasValue || o.StartAt < endBefore.Value)
                        && (!startFrom.HasValue || o.EndAt > startFrom.Value);
                if (o.StartAt is not null)
                    return (!startFrom.HasValue || o.StartAt >= startFrom.Value)
                        && (!endBefore.HasValue || o.StartAt < endBefore.Value);
                if (o.EndAt is not null)
                    return (!startFrom.HasValue || o.EndAt >= startFrom.Value)
                        && (!endBefore.HasValue || o.EndAt < endBefore.Value);
                return false;
            });
        }

        var ctx = await settings.GetDayContextAsync(userId);
        var now = DateTimeOffset.UtcNow;
        return occurrences
            .OrderBy(o => o.StartAt ?? o.EndAt ?? DateTimeOffset.MaxValue)
            .ThenBy(o => o.CreatedAt)
            .Select(o => OccurrenceDto.FromEntity(o, ctx, now))
            .ToList();
    }

    public async Task<Result<OccurrenceDto>> UpdateAsync(Guid id, Guid userId, UpdateOccurrenceRequest req)
    {
        var err = ValidateOptionalTitle(req.Title)
            ?? Validators.ValidateDateRange(req.StartAt, req.EndAt)
            ?? ValidateDuration(req.IsPlanned, req.StartAt, req.EndAt, req.DurationMinutes)
            ?? ValidateSubtaskInputs(req.Subtasks);
        if (err is not null) return Result<OccurrenceDto>.Fail(err);

        var o = await WithFullIncludes()
            .FirstOrDefaultAsync(o => o.Id == id && o.UserId == userId);
        if (o is null) return Result<OccurrenceDto>.Fail(new Error(ErrorType.NotFound, "Occurrence not found."));

        o.Title = string.IsNullOrWhiteSpace(req.Title) ? null : req.Title.Trim();
        o.StartAt = req.StartAt;
        o.EndAt = req.EndAt;
        o.IsAllDay = req.IsAllDay;
        o.IsPlanned = req.IsPlanned;
        o.DurationMinutes = req.DurationMinutes;

        var subtaskErr = ApplySubtasks(o, req.Subtasks);
        if (subtaskErr is not null) return Result<OccurrenceDto>.Fail(subtaskErr);

        await db.SaveChangesAsync();
        return Result<OccurrenceDto>.Success(await ToDtoAsync(o, userId));
    }

    public async Task<Result> DeleteAsync(Guid id, Guid userId)
    {
        var o = await db.Occurrences
            .Include(o => o.Activity)
            .FirstOrDefaultAsync(o => o.Id == id && o.UserId == userId);
        if (o is null) return Result.Fail(new Error(ErrorType.NotFound, "Occurrence not found."));

        // For event-kind, delete the backing activity (cascade removes the occurrence).
        if (o.Activity.Kind == ActivityKind.@event)
            db.Activities.Remove(o.Activity);
        else
            db.Occurrences.Remove(o);

        await db.SaveChangesAsync();
        return Result.Success();
    }

    public async Task<Result<OccurrenceDto>> CreateEventAsync(Guid userId, CreateEventRequest req)
    {
        var err = Validators.ValidateTitle(req.Title, "Title")
            ?? Validators.ValidateDateRange(req.StartAt, req.EndAt)
            ?? ValidateDuration(req.IsPlanned, req.StartAt, req.EndAt, req.DurationMinutes);
        if (err is not null) return Result<OccurrenceDto>.Fail(err);

        var a = new Activity
        {
            UserId = userId,
            Title = req.Title.Trim(),
            Kind = ActivityKind.@event,
        };

        if (req.CategoryId.HasValue)
        {
            var cat = await db.Categories.FirstOrDefaultAsync(c => c.Id == req.CategoryId.Value && c.UserId == userId);
            if (cat is null) return Result<OccurrenceDto>.Fail(new Error(ErrorType.NotFound, "Category not found."));
            a.CategoryId = req.CategoryId.Value;
            a.Category = cat;
        }

        if (req.GoalId.HasValue)
        {
            var goal = await db.Goals.FirstOrDefaultAsync(g => g.Id == req.GoalId.Value && g.UserId == userId);
            if (goal is null) return Result<OccurrenceDto>.Fail(new Error(ErrorType.NotFound, "Goal not found."));
            a.GoalId = req.GoalId.Value;
            a.Goal = goal;
        }

        db.Activities.Add(a);

        var o = new Occurrence
        {
            UserId = userId,
            ActivityId = a.Id,
            Activity = a,
            StartAt = req.StartAt,
            EndAt = req.EndAt,
            IsAllDay = req.IsAllDay,
            IsPlanned = req.IsPlanned,
            DurationMinutes = req.DurationMinutes,
        };
        db.Occurrences.Add(o);
        await db.SaveChangesAsync();
        return Result<OccurrenceDto>.Success(await ToDtoAsync(o, userId));
    }

    public async Task<Result<OccurrenceDto>> UpdateEventAsync(Guid id, Guid userId, UpdateEventRequest req)
    {
        var err = Validators.ValidateTitle(req.Title, "Title")
            ?? Validators.ValidateDateRange(req.StartAt, req.EndAt)
            ?? ValidateDuration(req.IsPlanned, req.StartAt, req.EndAt, req.DurationMinutes)
            ?? ValidateSubtaskInputs(req.Subtasks);
        if (err is not null) return Result<OccurrenceDto>.Fail(err);

        var o = await WithFullIncludes()
            .FirstOrDefaultAsync(o => o.Id == id && o.UserId == userId);
        if (o is null) return Result<OccurrenceDto>.Fail(new Error(ErrorType.NotFound, "Occurrence not found."));
        if (o.Activity.Kind != ActivityKind.@event)
            return Result<OccurrenceDto>.Fail(new Error(ErrorType.Validation, "Use the standard update endpoint for activity-based occurrences."));

        o.Activity.Title = req.Title.Trim();

        if (req.CategoryId.HasValue)
        {
            var cat = await db.Categories.FirstOrDefaultAsync(c => c.Id == req.CategoryId.Value && c.UserId == userId);
            if (cat is null) return Result<OccurrenceDto>.Fail(new Error(ErrorType.NotFound, "Category not found."));
            o.Activity.CategoryId = req.CategoryId.Value;
            o.Activity.Category = cat;
        }
        else
        {
            o.Activity.CategoryId = null;
            o.Activity.Category = null;
        }

        if (req.GoalId.HasValue)
        {
            var goal = await db.Goals.FirstOrDefaultAsync(g => g.Id == req.GoalId.Value && g.UserId == userId);
            if (goal is null) return Result<OccurrenceDto>.Fail(new Error(ErrorType.NotFound, "Goal not found."));
            o.Activity.GoalId = req.GoalId.Value;
            o.Activity.Goal = goal;
        }
        else
        {
            o.Activity.GoalId = null;
            o.Activity.Goal = null;
        }

        o.StartAt = req.StartAt;
        o.EndAt = req.EndAt;
        o.IsAllDay = req.IsAllDay;
        o.IsPlanned = req.IsPlanned;
        o.DurationMinutes = req.DurationMinutes;

        var subtaskErr = ApplySubtasks(o, req.Subtasks);
        if (subtaskErr is not null) return Result<OccurrenceDto>.Fail(subtaskErr);

        await db.SaveChangesAsync();
        return Result<OccurrenceDto>.Success(await ToDtoAsync(o, userId));
    }

    public async Task<Result<OccurrenceDto>> SetStatusAsync(Guid id, Guid userId, EventStatus status)
    {
        var o = await WithFullIncludes()
            .FirstOrDefaultAsync(o => o.Id == id && o.UserId == userId);
        if (o is null) return Result<OccurrenceDto>.Fail(new Error(ErrorType.NotFound, "Occurrence not found."));
        o.Status = status;
        if (status == EventStatus.done) o.IsPlanned = false;
        await db.SaveChangesAsync();
        return Result<OccurrenceDto>.Success(await ToDtoAsync(o, userId));
    }

    public async Task<Result<OccurrenceDto>> ToggleSubtaskAsync(Guid id, Guid subtaskId, Guid userId)
    {
        var o = await WithFullIncludes()
            .FirstOrDefaultAsync(o => o.Id == id && o.UserId == userId);
        if (o is null) return Result<OccurrenceDto>.Fail(new Error(ErrorType.NotFound, "Occurrence not found."));

        var subtask = o.Subtasks.FirstOrDefault(s => s.Id == subtaskId);
        if (subtask is null) return Result<OccurrenceDto>.Fail(new Error(ErrorType.NotFound, "Subtask not found."));

        subtask.IsDone = !subtask.IsDone;
        await db.SaveChangesAsync();
        return Result<OccurrenceDto>.Success(await ToDtoAsync(o, userId));
    }

    public async Task<Result<OccurrenceDto>> CreateSubtaskAsync(Guid id, Guid userId, CreateOccurrenceSubtaskRequest req)
    {
        var err = Validators.ValidateTitle(req.Title, "Title");
        if (err is not null) return Result<OccurrenceDto>.Fail(err);

        var o = await WithFullIncludes()
            .FirstOrDefaultAsync(o => o.Id == id && o.UserId == userId);
        if (o is null) return Result<OccurrenceDto>.Fail(new Error(ErrorType.NotFound, "Occurrence not found."));

        // Explicit Add forces the Added state (the pre-set Guid key would otherwise make
        // change detection treat it as an existing row); fixup then puts it into o.Subtasks.
        var subtask = new OccurrenceSubtask { OccurrenceId = id, Title = req.Title.Trim() };
        db.OccurrenceSubtasks.Add(subtask);
        await db.SaveChangesAsync();
        return Result<OccurrenceDto>.Success(await ToDtoAsync(o, userId));
    }

    public async Task<Result<OccurrenceDto>> UpdateSubtaskAsync(Guid id, Guid subtaskId, Guid userId, UpdateOccurrenceSubtaskRequest req)
    {
        var err = Validators.ValidateTitle(req.Title, "Title");
        if (err is not null) return Result<OccurrenceDto>.Fail(err);

        var o = await WithFullIncludes()
            .FirstOrDefaultAsync(o => o.Id == id && o.UserId == userId);
        if (o is null) return Result<OccurrenceDto>.Fail(new Error(ErrorType.NotFound, "Occurrence not found."));

        var subtask = o.Subtasks.FirstOrDefault(s => s.Id == subtaskId);
        if (subtask is null) return Result<OccurrenceDto>.Fail(new Error(ErrorType.NotFound, "Subtask not found."));

        subtask.Title = req.Title.Trim();
        await db.SaveChangesAsync();
        return Result<OccurrenceDto>.Success(await ToDtoAsync(o, userId));
    }

    public async Task<Result<OccurrenceDto>> DeleteSubtaskAsync(Guid id, Guid subtaskId, Guid userId)
    {
        var o = await WithFullIncludes()
            .FirstOrDefaultAsync(o => o.Id == id && o.UserId == userId);
        if (o is null) return Result<OccurrenceDto>.Fail(new Error(ErrorType.NotFound, "Occurrence not found."));

        var subtask = o.Subtasks.FirstOrDefault(s => s.Id == subtaskId);
        if (subtask is null) return Result<OccurrenceDto>.Fail(new Error(ErrorType.NotFound, "Subtask not found."));

        o.Subtasks.Remove(subtask);
        db.OccurrenceSubtasks.Remove(subtask);
        await db.SaveChangesAsync();
        return Result<OccurrenceDto>.Success(await ToDtoAsync(o, userId));
    }

    private async Task<OccurrenceDto> ToDtoAsync(Occurrence o, Guid userId)
    {
        var ctx = await settings.GetDayContextAsync(userId);
        return OccurrenceDto.FromEntity(o, ctx, DateTimeOffset.UtcNow);
    }

    private IQueryable<Occurrence> WithFullIncludes() =>
        db.Occurrences
            .Include(o => o.Activity).ThenInclude(a => a.Category)
            .Include(o => o.Activity).ThenInclude(a => a.Goal)
            .Include(o => o.Activity).ThenInclude(a => a.Subtasks)
            .Include(o => o.Subtasks);

    private static Error? ValidateSubtaskInputs(List<OccurrenceSubtaskInput>? inputs)
    {
        if (inputs is null) return null;
        foreach (var input in inputs)
        {
            var err = Validators.ValidateTitle(input.Title, "Subtask title");
            if (err is not null) return err;
        }
        return null;
    }

    // Reconciles the occurrence's subtasks with the full set from the request:
    // known ids are kept (title updated, IsDone preserved), missing ids are deleted,
    // null-id entries are created. A null list leaves subtasks untouched.
    private Error? ApplySubtasks(Occurrence o, List<OccurrenceSubtaskInput>? inputs)
    {
        if (inputs is null) return null;

        var existing = o.Subtasks.ToDictionary(s => s.Id);
        var keptIds = inputs.Where(i => i.Id.HasValue).Select(i => i.Id!.Value).ToHashSet();

        if (!keptIds.All(existing.ContainsKey))
            return new Error(ErrorType.NotFound, "Subtask not found.");

        foreach (var removed in o.Subtasks.Where(s => !keptIds.Contains(s.Id)).ToList())
        {
            o.Subtasks.Remove(removed);
            db.OccurrenceSubtasks.Remove(removed);
        }

        foreach (var input in inputs)
        {
            if (input.Id.HasValue)
                existing[input.Id.Value].Title = input.Title.Trim();
            else
                // Explicit Add forces the Added state (the pre-set Guid key would otherwise
                // make change detection treat it as an existing row); fixup adds it to o.Subtasks.
                db.OccurrenceSubtasks.Add(new OccurrenceSubtask { OccurrenceId = o.Id, Title = input.Title.Trim() });
        }

        return null;
    }

    private static Error? ValidateWindowAndStartAt(DateTimeOffset? startAt, DateTimeOffset? windowStart) =>
        startAt.HasValue && windowStart.HasValue
            ? new Error(ErrorType.Validation, "StartAt and WindowStart cannot both be set.")
            : null;

    private static Error? ValidateOptionalTitle(string? title) =>
        !string.IsNullOrWhiteSpace(title) && title.Length > 255
            ? new Error(ErrorType.Validation, "Title cannot exceed 255 characters.")
            : null;

    private static Error? ValidateDuration(
        bool isPlanned,
        DateTimeOffset? startAt,
        DateTimeOffset? endAt,
        int? durationMinutes)
    {
        if (isPlanned && startAt.HasValue && endAt.HasValue && durationMinutes.HasValue)
        {
            var windowMinutes = (int)(endAt.Value - startAt.Value).TotalMinutes;
            if (durationMinutes.Value > windowMinutes)
                return new Error(ErrorType.Validation, "Duration cannot exceed the length of the window.");
        }
        return null;
    }
}
