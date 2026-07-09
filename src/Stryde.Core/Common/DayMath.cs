using Stryde.Core.Entities;
using Stryde.Core.Enums;

namespace Stryde.Core.Common;

/// <summary>The user's local-time context: IANA timezone plus the configurable day boundary.</summary>
public sealed record DayContext(TimeZoneInfo TimeZone, TimeOnly DayBoundary);

/// <summary>
/// Pure day-bucketing rules. All "which day is this?" and overdue decisions go through here
/// so the recommendation engine, DTO mapping, and (later) recurrence agree on what "today" means.
/// A day runs from the day boundary to the next day's boundary in the user's timezone.
/// </summary>
public static class DayMath
{
    public static TimeZoneInfo ResolveTimeZone(string? timezoneId)
    {
        if (string.IsNullOrWhiteSpace(timezoneId)) return TimeZoneInfo.Utc;
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(timezoneId);
        }
        catch (TimeZoneNotFoundException)
        {
            return TimeZoneInfo.Utc;
        }
        catch (InvalidTimeZoneException)
        {
            return TimeZoneInfo.Utc;
        }
    }

    /// <summary>The local day an instant belongs to. Instants before the boundary belong to the previous day.</summary>
    public static DateOnly DayOf(DateTimeOffset instant, DayContext ctx)
    {
        var local = TimeZoneInfo.ConvertTime(instant, ctx.TimeZone);
        var date = DateOnly.FromDateTime(local.DateTime);
        return TimeOnly.FromDateTime(local.DateTime) < ctx.DayBoundary ? date.AddDays(-1) : date;
    }

    public static DateOnly Today(DayContext ctx, DateTimeOffset nowUtc) => DayOf(nowUtc, ctx);

    /// <summary>The instant at which the given day ends: the boundary time on the following date.</summary>
    public static DateTimeOffset EndOfDay(DateOnly day, DayContext ctx)
    {
        var nextLocal = day.AddDays(1).ToDateTime(ctx.DayBoundary);
        return new DateTimeOffset(nextLocal, ctx.TimeZone.GetUtcOffset(nextLocal));
    }

    /// <summary>An occurrence's day is the day it starts on. Floating occurrences have no day.</summary>
    public static DateOnly? OccurrenceDay(Occurrence o, DayContext ctx) =>
        o.StartAt.HasValue ? DayOf(o.StartAt.Value, ctx) : null;

    /// <summary>
    /// Overdue: pending, and either the end datetime has passed, or (start-only) the occurrence's day has ended.
    /// All-day occurrences are overdue when the calendar date has passed (ignoring day boundary).
    /// Floating occurrences are never overdue.
    /// </summary>
    public static bool IsOverdue(Occurrence o, DayContext ctx, DateTimeOffset nowUtc)
    {
        if (o.Status != EventStatus.pending) return false;
        if (o.StartAt is null) return false;
        if (o.EndAt.HasValue) return o.EndAt.Value < nowUtc;
        if (o.IsAllDay)
        {
            var occDate = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(o.StartAt.Value, ctx.TimeZone).DateTime);
            return occDate < Today(ctx, nowUtc);
        }
        return EndOfDay(DayOf(o.StartAt.Value, ctx), ctx) <= nowUtc;
    }
}
