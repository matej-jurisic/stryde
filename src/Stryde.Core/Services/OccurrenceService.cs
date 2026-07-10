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
        if (floatingOnly) query = query.Where(o => o.StartAt == null);

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
        var o = await db.Occurrences.FirstOrDefaultAsync(o => o.Id == id && o.UserId == userId);
        if (o is null) return Result.Fail(new Error(ErrorType.NotFound, "Occurrence not found."));
        db.Occurrences.Remove(o);
        await db.SaveChangesAsync();
        return Result.Success();
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
