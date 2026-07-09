using Microsoft.EntityFrameworkCore;
using Stryde.Core.Common;
using Stryde.Core.Data;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;
using Stryde.Core.Enums;

namespace Stryde.Core.Services;

public class EventService(StrydeDbContext db, UserSettingsService settings)
{
    public async Task<Result<EventDto>> CreateAsync(Guid userId, CreateEventRequest req)
    {
        var err = Validators.ValidateTitle(req.Title, "Title")
            ?? Validators.ValidateDateRange(req.StartAt, req.EndAt)
            ?? ValidateWindow(req.StartAt, req.WindowStart, req.WindowEnd, req.WindowDurationMinutes);
        if (err is not null) return Result<EventDto>.Fail(err);

        var ev = new Event
        {
            UserId = userId,
            Title = req.Title.Trim(),
            StartAt = req.StartAt,
            EndAt = req.IsAllDay ? null : req.EndAt,
            IsAllDay = req.IsAllDay,
            WindowStart = req.WindowStart,
            WindowEnd = req.WindowEnd,
            WindowDurationMinutes = req.WindowDurationMinutes,
        };

        if (req.CategoryId.HasValue)
        {
            var cat = await db.Categories.FirstOrDefaultAsync(c => c.Id == req.CategoryId.Value && c.UserId == userId);
            if (cat is null) return Result<EventDto>.Fail(new Error(ErrorType.NotFound, "Category not found."));
            ev.CategoryId = req.CategoryId.Value;
        }

        if (req.GoalIds is { Count: > 0 })
        {
            var goals = await db.Goals
                .Where(g => req.GoalIds.Contains(g.Id) && g.UserId == userId)
                .ToListAsync();
            ev.Goals.AddRange(goals);
        }

        if (req.BaseEventId.HasValue)
        {
            var be = await db.BaseEvents.FirstOrDefaultAsync(b => b.Id == req.BaseEventId.Value && b.UserId == userId);
            if (be is null) return Result<EventDto>.Fail(new Error(ErrorType.NotFound, "Base event not found."));
            ev.BaseEventId = be.Id;
        }
        else
        {
            var be = new BaseEvent { UserId = userId, Title = ev.Title, CategoryId = ev.CategoryId };
            be.Goals.AddRange(ev.Goals);
            db.BaseEvents.Add(be);
            ev.BaseEventId = be.Id;
        }

        db.Events.Add(ev);
        await db.SaveChangesAsync();
        return Result<EventDto>.Success(await ToDtoAsync(ev, userId));
    }

    public async Task<Result<EventDto>> GetAsync(Guid id, Guid userId)
    {
        var ev = await db.Events
            .Include(e => e.Goals)
            .Include(e => e.Category)
            .FirstOrDefaultAsync(e => e.Id == id && e.UserId == userId);
        if (ev is null) return Result<EventDto>.Fail(new Error(ErrorType.NotFound, "Event not found."));
        return Result<EventDto>.Success(await ToDtoAsync(ev, userId));
    }

    public async Task<List<EventDto>> ListAsync(
        Guid userId,
        EventStatus? status = null,
        DateTimeOffset? startFrom = null,
        DateTimeOffset? endBefore = null,
        bool floatingOnly = false)
    {
        var query = db.Events
            .Include(e => e.Goals)
            .Include(e => e.Category)
            .Where(e => e.UserId == userId);

        if (status.HasValue) query = query.Where(e => e.Status == status.Value);
        // floatingOnly excludes windowed events (they belong on the calendar, not the inbox)
        if (floatingOnly) query = query.Where(e => e.StartAt == null && e.WindowStart == null);

        var all = await query.ToListAsync();

        // DateTimeOffset comparisons must be done client-side on SQLite
        IEnumerable<Event> events = all;
        if (startFrom.HasValue || endBefore.HasValue)
        {
            events = events.Where(e =>
            {
                if (e.StartAt is not null)
                    return (!startFrom.HasValue || e.StartAt >= startFrom.Value)
                        && (!endBefore.HasValue || e.StartAt < endBefore.Value);
                // Include windowed events whose window overlaps the requested range
                if (e.WindowStart is not null && e.WindowEnd is not null)
                    return (!endBefore.HasValue || e.WindowStart < endBefore.Value)
                        && (!startFrom.HasValue || e.WindowEnd > startFrom.Value);
                return false;
            });
        }

        var ctx = await settings.GetDayContextAsync(userId);
        var now = DateTimeOffset.UtcNow;
        return events
            .OrderBy(e => e.StartAt ?? e.WindowStart ?? DateTimeOffset.MaxValue)
            .ThenBy(e => e.CreatedAt)
            .Select(e => EventDto.FromEntity(e, ctx, now))
            .ToList();
    }

    public async Task<Result<EventDto>> UpdateAsync(Guid id, Guid userId, UpdateEventRequest req)
    {
        var err = Validators.ValidateTitle(req.Title, "Title")
            ?? Validators.ValidateDateRange(req.StartAt, req.EndAt)
            ?? ValidateWindow(req.StartAt, req.WindowStart, req.WindowEnd, req.WindowDurationMinutes);
        if (err is not null) return Result<EventDto>.Fail(err);

        var ev = await db.Events
            .Include(e => e.Goals)
            .Include(e => e.Category)
            .FirstOrDefaultAsync(e => e.Id == id && e.UserId == userId);
        if (ev is null) return Result<EventDto>.Fail(new Error(ErrorType.NotFound, "Event not found."));

        ev.Title = req.Title.Trim();
        ev.StartAt = req.StartAt;
        ev.EndAt = req.IsAllDay ? null : req.EndAt;
        ev.IsAllDay = req.IsAllDay;
        ev.WindowStart = req.WindowStart;
        ev.WindowEnd = req.WindowEnd;
        ev.WindowDurationMinutes = req.WindowDurationMinutes;
        ev.CategoryId = req.CategoryId;

        if (req.CategoryId.HasValue)
        {
            var cat = await db.Categories.FirstOrDefaultAsync(c => c.Id == req.CategoryId.Value && c.UserId == userId);
            if (cat is null) return Result<EventDto>.Fail(new Error(ErrorType.NotFound, "Category not found."));
            ev.Category = cat;
        }
        else
        {
            ev.Category = null;
        }

        if (req.GoalIds is not null)
        {
            ev.Goals.Clear();
            if (req.GoalIds.Count > 0)
            {
                var goals = await db.Goals
                    .Where(g => req.GoalIds.Contains(g.Id) && g.UserId == userId)
                    .ToListAsync();
                ev.Goals.AddRange(goals);
            }
        }

        await db.SaveChangesAsync();
        return Result<EventDto>.Success(await ToDtoAsync(ev, userId));
    }

    public async Task<Result> DeleteAsync(Guid id, Guid userId)
    {
        var ev = await db.Events.FirstOrDefaultAsync(e => e.Id == id && e.UserId == userId);
        if (ev is null) return Result.Fail(new Error(ErrorType.NotFound, "Event not found."));

        var baseEventId = ev.BaseEventId;
        db.Events.Remove(ev);
        await db.SaveChangesAsync();

        // Clean up the BaseEvent if no other events reference it
        if (baseEventId.HasValue)
        {
            var hasOtherEvents = await db.Events.AnyAsync(e => e.BaseEventId == baseEventId.Value);
            if (!hasOtherEvents)
            {
                var be = await db.BaseEvents.FindAsync(baseEventId.Value);
                if (be is not null) db.BaseEvents.Remove(be);
                await db.SaveChangesAsync();
            }
        }

        return Result.Success();
    }

    public async Task<Result<EventDto>> SetStatusAsync(Guid id, Guid userId, EventStatus status)
    {
        var ev = await db.Events
            .Include(e => e.Goals)
            .Include(e => e.Category)
            .FirstOrDefaultAsync(e => e.Id == id && e.UserId == userId);
        if (ev is null) return Result<EventDto>.Fail(new Error(ErrorType.NotFound, "Event not found."));
        ev.Status = status;
        await db.SaveChangesAsync();
        return Result<EventDto>.Success(await ToDtoAsync(ev, userId));
    }

    private async Task<EventDto> ToDtoAsync(Event ev, Guid userId)
    {
        var ctx = await settings.GetDayContextAsync(userId);
        return EventDto.FromEntity(ev, ctx, DateTimeOffset.UtcNow);
    }

    private static Error? ValidateWindow(
        DateTimeOffset? startAt,
        DateTimeOffset? windowStart,
        DateTimeOffset? windowEnd,
        int? durationMinutes)
    {
        var hasWindow = windowStart.HasValue || windowEnd.HasValue || durationMinutes.HasValue;
        if (!hasWindow) return null;

        if (startAt.HasValue)
            return new Error(ErrorType.Validation, "A windowed event cannot also have a start time.");
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
