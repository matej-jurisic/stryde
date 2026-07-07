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
            ?? Validators.ValidateDateRange(req.StartAt, req.EndAt);
        if (err is not null) return Result<EventDto>.Fail(err);

        var ev = new Event { UserId = userId, Title = req.Title.Trim(), StartAt = req.StartAt, EndAt = req.EndAt };

        if (req.GoalIds is { Count: > 0 })
        {
            var goals = await db.Goals
                .Where(g => req.GoalIds.Contains(g.Id) && g.UserId == userId)
                .ToListAsync();
            ev.Goals.AddRange(goals);
        }

        db.Events.Add(ev);
        await db.SaveChangesAsync();
        return Result<EventDto>.Success(await ToDtoAsync(ev, userId));
    }

    public async Task<Result<EventDto>> GetAsync(Guid id, Guid userId)
    {
        var ev = await db.Events
            .Include(e => e.Goals)
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
            .Where(e => e.UserId == userId);

        if (status.HasValue) query = query.Where(e => e.Status == status.Value);
        if (floatingOnly) query = query.Where(e => e.StartAt == null);

        var all = await query.ToListAsync();

        // DateTimeOffset comparisons must be done client-side on SQLite
        IEnumerable<Event> events = all;
        if (startFrom.HasValue) events = events.Where(e => e.StartAt >= startFrom.Value);
        if (endBefore.HasValue) events = events.Where(e => e.StartAt < endBefore.Value);

        var ctx = await settings.GetDayContextAsync(userId);
        var now = DateTimeOffset.UtcNow;
        return events
            .OrderBy(e => e.StartAt ?? DateTimeOffset.MaxValue)
            .ThenBy(e => e.CreatedAt)
            .Select(e => EventDto.FromEntity(e, ctx, now))
            .ToList();
    }

    public async Task<Result<EventDto>> UpdateAsync(Guid id, Guid userId, UpdateEventRequest req)
    {
        var err = Validators.ValidateTitle(req.Title, "Title")
            ?? Validators.ValidateDateRange(req.StartAt, req.EndAt);
        if (err is not null) return Result<EventDto>.Fail(err);

        var ev = await db.Events
            .Include(e => e.Goals)
            .FirstOrDefaultAsync(e => e.Id == id && e.UserId == userId);
        if (ev is null) return Result<EventDto>.Fail(new Error(ErrorType.NotFound, "Event not found."));

        ev.Title = req.Title.Trim();
        ev.StartAt = req.StartAt;
        ev.EndAt = req.EndAt;

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
        db.Events.Remove(ev);
        await db.SaveChangesAsync();
        return Result.Success();
    }

    public async Task<Result<EventDto>> SetStatusAsync(Guid id, Guid userId, EventStatus status)
    {
        var ev = await db.Events
            .Include(e => e.Goals)
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
}
