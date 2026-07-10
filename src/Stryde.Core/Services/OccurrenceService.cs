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
            ?? Validators.ValidateDateRange(req.StartAt, req.EndAt)
            ?? ValidateWindow(req.StartAt, req.WindowStart, req.WindowEnd, req.WindowDurationMinutes);
        if (err is not null) return Result<OccurrenceDto>.Fail(err);

        var activity = await db.Activities
            .Include(a => a.Category)
            .Include(a => a.Goal)
            .FirstOrDefaultAsync(a => a.Id == req.ActivityId && a.UserId == userId);
        if (activity is null) return Result<OccurrenceDto>.Fail(new Error(ErrorType.NotFound, "Activity not found."));

        var o = new Occurrence
        {
            UserId = userId,
            ActivityId = activity.Id,
            Activity = activity,
            Title = string.IsNullOrWhiteSpace(req.Title) ? null : req.Title.Trim(),
            StartAt = req.StartAt,
            EndAt = req.IsAllDay ? null : req.EndAt,
            IsAllDay = req.IsAllDay,
            WindowStart = req.WindowStart,
            WindowEnd = req.WindowEnd,
            WindowDurationMinutes = req.WindowDurationMinutes,
        };

        db.Occurrences.Add(o);
        await db.SaveChangesAsync();
        return Result<OccurrenceDto>.Success(await ToDtoAsync(o, userId));
    }

    public async Task<Result<OccurrenceDto>> GetAsync(Guid id, Guid userId)
    {
        var o = await db.Occurrences
            .Include(o => o.Activity).ThenInclude(a => a.Category)
            .Include(o => o.Activity).ThenInclude(a => a.Goal)
            .FirstOrDefaultAsync(o => o.Id == id && o.UserId == userId);
        if (o is null) return Result<OccurrenceDto>.Fail(new Error(ErrorType.NotFound, "Occurrence not found."));
        return Result<OccurrenceDto>.Success(await ToDtoAsync(o, userId));
    }

    public async Task<List<OccurrenceDto>> ListAsync(
        Guid userId,
        EventStatus? status = null,
        DateTimeOffset? startFrom = null,
        DateTimeOffset? endBefore = null,
        bool floatingOnly = false)
    {
        var query = db.Occurrences
            .Include(o => o.Activity).ThenInclude(a => a.Category)
            .Include(o => o.Activity).ThenInclude(a => a.Goal)
            .Where(o => o.UserId == userId);

        if (status.HasValue) query = query.Where(o => o.Status == status.Value);
        if (floatingOnly) query = query.Where(o => o.StartAt == null && o.WindowStart == null);

        var all = await query.ToListAsync();

        IEnumerable<Occurrence> occurrences = all;
        if (startFrom.HasValue || endBefore.HasValue)
        {
            occurrences = occurrences.Where(o =>
            {
                if (o.StartAt is not null)
                    return (!startFrom.HasValue || o.StartAt >= startFrom.Value)
                        && (!endBefore.HasValue || o.StartAt < endBefore.Value);
                if (o.WindowStart is not null && o.WindowEnd is not null)
                    return (!endBefore.HasValue || o.WindowStart < endBefore.Value)
                        && (!startFrom.HasValue || o.WindowEnd > startFrom.Value);
                return false;
            });
        }

        var ctx = await settings.GetDayContextAsync(userId);
        var now = DateTimeOffset.UtcNow;
        return occurrences
            .OrderBy(o => o.StartAt ?? o.WindowStart ?? DateTimeOffset.MaxValue)
            .ThenBy(o => o.CreatedAt)
            .Select(o => OccurrenceDto.FromEntity(o, ctx, now))
            .ToList();
    }

    public async Task<Result<OccurrenceDto>> UpdateAsync(Guid id, Guid userId, UpdateOccurrenceRequest req)
    {
        var err = ValidateOptionalTitle(req.Title)
            ?? Validators.ValidateDateRange(req.StartAt, req.EndAt)
            ?? ValidateWindow(req.StartAt, req.WindowStart, req.WindowEnd, req.WindowDurationMinutes);
        if (err is not null) return Result<OccurrenceDto>.Fail(err);

        var o = await db.Occurrences
            .Include(o => o.Activity).ThenInclude(a => a.Category)
            .Include(o => o.Activity).ThenInclude(a => a.Goal)
            .FirstOrDefaultAsync(o => o.Id == id && o.UserId == userId);
        if (o is null) return Result<OccurrenceDto>.Fail(new Error(ErrorType.NotFound, "Occurrence not found."));

        o.Title = string.IsNullOrWhiteSpace(req.Title) ? null : req.Title.Trim();
        o.StartAt = req.StartAt;
        o.EndAt = req.IsAllDay ? null : req.EndAt;
        o.IsAllDay = req.IsAllDay;
        o.WindowStart = req.WindowStart;
        o.WindowEnd = req.WindowEnd;
        o.WindowDurationMinutes = req.WindowDurationMinutes;

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
            ?? ValidateWindow(req.StartAt, req.WindowStart, req.WindowEnd, req.WindowDurationMinutes);
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
            EndAt = req.IsAllDay ? null : req.EndAt,
            IsAllDay = req.IsAllDay,
            WindowStart = req.WindowStart,
            WindowEnd = req.WindowEnd,
            WindowDurationMinutes = req.WindowDurationMinutes,
        };
        db.Occurrences.Add(o);
        await db.SaveChangesAsync();
        return Result<OccurrenceDto>.Success(await ToDtoAsync(o, userId));
    }

    public async Task<Result<OccurrenceDto>> UpdateEventAsync(Guid id, Guid userId, UpdateEventRequest req)
    {
        var err = Validators.ValidateTitle(req.Title, "Title")
            ?? Validators.ValidateDateRange(req.StartAt, req.EndAt)
            ?? ValidateWindow(req.StartAt, req.WindowStart, req.WindowEnd, req.WindowDurationMinutes);
        if (err is not null) return Result<OccurrenceDto>.Fail(err);

        var o = await db.Occurrences
            .Include(o => o.Activity).ThenInclude(a => a.Category)
            .Include(o => o.Activity).ThenInclude(a => a.Goal)
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
        o.EndAt = req.IsAllDay ? null : req.EndAt;
        o.IsAllDay = req.IsAllDay;
        o.WindowStart = req.WindowStart;
        o.WindowEnd = req.WindowEnd;
        o.WindowDurationMinutes = req.WindowDurationMinutes;

        await db.SaveChangesAsync();
        return Result<OccurrenceDto>.Success(await ToDtoAsync(o, userId));
    }

    public async Task<Result<OccurrenceDto>> SetStatusAsync(Guid id, Guid userId, EventStatus status)
    {
        var o = await db.Occurrences
            .Include(o => o.Activity).ThenInclude(a => a.Category)
            .Include(o => o.Activity).ThenInclude(a => a.Goal)
            .FirstOrDefaultAsync(o => o.Id == id && o.UserId == userId);
        if (o is null) return Result<OccurrenceDto>.Fail(new Error(ErrorType.NotFound, "Occurrence not found."));
        o.Status = status;
        await db.SaveChangesAsync();
        return Result<OccurrenceDto>.Success(await ToDtoAsync(o, userId));
    }

    private async Task<OccurrenceDto> ToDtoAsync(Occurrence o, Guid userId)
    {
        var ctx = await settings.GetDayContextAsync(userId);
        return OccurrenceDto.FromEntity(o, ctx, DateTimeOffset.UtcNow);
    }

    private static Error? ValidateOptionalTitle(string? title) =>
        !string.IsNullOrWhiteSpace(title) && title.Length > 255
            ? new Error(ErrorType.Validation, "Title cannot exceed 255 characters.")
            : null;

    private static Error? ValidateWindow(
        DateTimeOffset? startAt,
        DateTimeOffset? windowStart,
        DateTimeOffset? windowEnd,
        int? durationMinutes)
    {
        var hasWindow = windowStart.HasValue || windowEnd.HasValue || durationMinutes.HasValue;
        if (!hasWindow) return null;

        if (startAt.HasValue)
            return new Error(ErrorType.Validation, "A windowed occurrence cannot also have a start time.");
        if (!windowStart.HasValue || !windowEnd.HasValue || !durationMinutes.HasValue)
            return new Error(ErrorType.Validation, "Window start, window end, and duration must all be provided together.");
        if (windowEnd.Value <= windowStart.Value)
            return new Error(ErrorType.Validation, "Window end must be after window start.");
        if (durationMinutes.Value <= 0)
            return new Error(ErrorType.Validation, "Duration must be greater than zero.");
        var windowMinutes = (int)(windowEnd.Value - windowStart.Value).TotalMinutes;
        if (durationMinutes.Value > windowMinutes)
            return new Error(ErrorType.Validation, "Duration cannot exceed the length of the window.");

        return null;
    }
}
