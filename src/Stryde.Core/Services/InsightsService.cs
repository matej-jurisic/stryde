using Microsoft.EntityFrameworkCore;
using Stryde.Core.Common;
using Stryde.Core.Data;
using Stryde.Core.Dtos;
using Stryde.Core.Enums;

namespace Stryde.Core.Services;

public class InsightsService(StrydeDbContext db, UserSettingsService settings)
{
    private static int? DurationOf(Entities.Occurrence o) =>
        o.StartAt.HasValue && o.EndAt.HasValue
            ? (int)(o.EndAt.Value - o.StartAt.Value).TotalMinutes
            : o.DurationMinutes;

    public async Task<InsightsDto> GetAsync(Guid userId, int windowDays = 30, DateTimeOffset? nowUtc = null)
    {
        var now = nowUtc ?? DateTimeOffset.UtcNow;
        var ctx = await settings.GetDayContextAsync(userId);
        var today = DayMath.Today(ctx, now);
        var windowStart = today.AddDays(-(windowDays - 1));

        var completed = await db.Occurrences
            .Include(o => o.Activity).ThenInclude(a => a.Category)
            .Where(o => o.UserId == userId && o.Status == EventStatus.done && o.StartAt != null)
            .ToListAsync();

        var inWindow = completed
            .Where(o => { var day = DayMath.DayOf(o.StartAt!.Value, ctx); return day >= windowStart && day <= today; })
            .ToList();

        // Only occurrences with both timestamps and positive elapsed time contribute to activity/category breakdown.
        var timed = inWindow
            .Where(o => o.StartAt.HasValue && o.EndAt.HasValue)
            .Select(o => (Occurrence: o, Minutes: (int)(o.EndAt!.Value - o.StartAt!.Value).TotalMinutes))
            .Where(x => x.Minutes > 0)
            .ToList();

        var activities = timed
            .GroupBy(x => x.Occurrence.ActivityId)
            .Select(g =>
            {
                var first = g.First().Occurrence;
                return new InsightsActivityDto(
                    first.ActivityId,
                    first.Activity.Title,
                    first.Activity.Category?.Color,
                    g.Sum(x => x.Minutes),
                    g.Count());
            })
            .OrderByDescending(a => a.TimeMinutes)
            .ThenByDescending(a => a.Count)
            .ToList();

        var categories = timed
            .GroupBy(x => x.Occurrence.Activity.Category?.Id)
            .Select(g =>
            {
                var cat = g.First().Occurrence.Activity.Category;
                return new InsightsCategoryDto(
                    cat?.Id, cat?.Name, cat?.Color, cat?.Icon,
                    g.Count(),
                    g.Sum(x => x.Minutes));
            })
            .OrderByDescending(c => c.TimeMinutes)
            .ThenBy(c => c.Name)
            .ToList();

        // Unaccounted time: 1440 - sum(durations) per day, averaged over days with at least one timed occurrence.
        // Today is excluded (still in progress, its remaining hours would read as unaccounted): the window is
        // the windowDays full days before today, and the previous window shifts back accordingly.
        Dictionary<DateOnly, int> TrackedByDay(DateOnly from, DateOnly to) => completed
            .Select(o => (Day: DayMath.DayOf(o.StartAt!.Value, ctx), Minutes: DurationOf(o)))
            .Where(x => x.Minutes is > 0 && x.Day >= from && x.Day <= to)
            .GroupBy(x => x.Day)
            .ToDictionary(g => g.Key, g => g.Sum(x => x.Minutes!.Value));

        static int? AvgUnaccounted(Dictionary<DateOnly, int> byDay) => byDay.Count > 0
            ? (int)byDay.Values.Select(m => Math.Max(0, 1440 - m)).Average()
            : null;

        var trackedEnd = today.AddDays(-1);
        var trackedByDay = TrackedByDay(trackedEnd.AddDays(-(windowDays - 1)), trackedEnd);
        var prevTrackedByDay = TrackedByDay(trackedEnd.AddDays(-(2 * windowDays - 1)), trackedEnd.AddDays(-windowDays));

        // Gap analysis runs only over tracked days (>=1 timed occurrence starting that day), but busy
        // intervals come from all completed occurrences so overnight spans cover the following morning.
        var intervals = completed
            .Select(o => (Start: o.StartAt!.Value, Minutes: DurationOf(o)))
            .Where(x => x.Minutes is > 0)
            .Select(x => (x.Start, End: x.Start.AddMinutes(x.Minutes!.Value)))
            .ToList();

        string LocalClock(DateTimeOffset instant) =>
            TimeZoneInfo.ConvertTime(instant, ctx.TimeZone).ToString("HH:mm");

        var gaps = new List<InsightsGapDto>();
        var slotEmptyDays = new int[24];

        foreach (var day in trackedByDay.Keys)
        {
            var dayStart = DayMath.StartOfDay(day, ctx);
            var dayEnd = DayMath.EndOfDay(day, ctx);

            var merged = new List<(DateTimeOffset Start, DateTimeOffset End)>();
            foreach (var iv in intervals
                         .Where(x => x.End > dayStart && x.Start < dayEnd)
                         .Select(x => (Start: x.Start < dayStart ? dayStart : x.Start, End: x.End > dayEnd ? dayEnd : x.End))
                         .OrderBy(x => x.Start))
            {
                if (merged.Count > 0 && iv.Start <= merged[^1].End)
                    merged[^1] = (merged[^1].Start, iv.End > merged[^1].End ? iv.End : merged[^1].End);
                else
                    merged.Add(iv);
            }

            var cursor = dayStart;
            foreach (var iv in merged)
            {
                if (iv.Start > cursor)
                    gaps.Add(new InsightsGapDto(day.ToString("O"), LocalClock(cursor), LocalClock(iv.Start), (int)(iv.Start - cursor).TotalMinutes));
                cursor = iv.End;
            }
            if (cursor < dayEnd)
                gaps.Add(new InsightsGapDto(day.ToString("O"), LocalClock(cursor), LocalClock(dayEnd), (int)(dayEnd - cursor).TotalMinutes));

            for (var i = 0; i < 24; i++)
            {
                var slotStart = dayStart.AddHours(i);
                var slotEnd = slotStart.AddHours(1);
                if (slotStart >= dayEnd) break;
                if (!merged.Any(x => x.Start < slotEnd && x.End > slotStart)) slotEmptyDays[i]++;
            }
        }

        var largestGaps = gaps.OrderByDescending(g => g.Minutes).Take(5).ToList();

        // Unused blocks: maximal runs of consecutive hour slots empty on a strict majority of tracked days.
        var runs = new List<(InsightsUnusedBlockDto Block, int Hours)>();
        var threshold = trackedByDay.Count / 2 + 1;
        for (var i = 0; i < 24;)
        {
            if (slotEmptyDays[i] < threshold) { i++; continue; }
            var start = i;
            var emptyDays = int.MaxValue;
            while (i < 24 && slotEmptyDays[i] >= threshold)
            {
                emptyDays = Math.Min(emptyDays, slotEmptyDays[i]);
                i++;
            }
            runs.Add((new InsightsUnusedBlockDto(
                ctx.DayBoundary.AddHours(start).ToString("HH:mm"),
                ctx.DayBoundary.AddHours(i).ToString("HH:mm"),
                emptyDays,
                trackedByDay.Count), i - start));
        }
        var unusedBlocks = runs
            .OrderByDescending(r => r.Block.EmptyDays)
            .ThenByDescending(r => r.Hours)
            .Take(3)
            .Select(r => r.Block)
            .ToList();

        return new InsightsDto(
            activities, categories,
            AvgUnaccounted(trackedByDay), AvgUnaccounted(prevTrackedByDay),
            largestGaps, unusedBlocks);
    }

    /// <summary>
    /// Likely-free profile for the calendar overlay: per weekday, the 1-hour slots that were empty
    /// on a strict majority of that weekday's tracked days over the last 8 weeks. Unlike the other
    /// insights, days here are midnight-to-midnight local calendar dates, because that is the grid the
    /// calendar renders. A day is tracked when at least one completed timed occurrence overlaps it.
    /// Today is excluded (still in progress). Weekdays with fewer than 3 tracked days fall back to the
    /// all-days profile.
    /// </summary>
    public async Task<InsightsEmptyProfileDto> GetEmptyProfileAsync(Guid userId, DateTimeOffset? nowUtc = null)
    {
        const int lookbackDays = 56;
        const int slotMinutes = 60;
        const int slotsPerDay = 1440 / slotMinutes;
        const int minWeekdaySamples = 3;

        var now = nowUtc ?? DateTimeOffset.UtcNow;
        var ctx = await settings.GetDayContextAsync(userId);
        var localToday = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, ctx.TimeZone).DateTime);
        var windowStart = localToday.AddDays(-lookbackDays);
        var windowEnd = localToday.AddDays(-1);

        var completed = await db.Occurrences
            .Where(o => o.UserId == userId && o.Status == EventStatus.done && o.StartAt != null)
            .ToListAsync();

        var intervals = completed
            .Select(o => (o.StartAt, Minutes: DurationOf(o)))
            .Where(x => x.Minutes is > 0)
            .Select(x => (
                Start: TimeZoneInfo.ConvertTime(x.StartAt!.Value, ctx.TimeZone).DateTime,
                End: TimeZoneInfo.ConvertTime(x.StartAt!.Value.AddMinutes(x.Minutes!.Value), ctx.TimeZone).DateTime));

        var busyByDay = new Dictionary<DateOnly, bool[]>();
        foreach (var (start, end) in intervals)
        {
            for (var date = DateOnly.FromDateTime(start); date <= DateOnly.FromDateTime(end); date = date.AddDays(1))
            {
                if (date < windowStart || date > windowEnd) continue;
                var dayStart = date.ToDateTime(TimeOnly.MinValue);
                var s = start > dayStart ? start : dayStart;
                var e = end < dayStart.AddDays(1) ? end : dayStart.AddDays(1);
                if (e <= s) continue;
                if (!busyByDay.TryGetValue(date, out var slots)) busyByDay[date] = slots = new bool[slotsPerDay];
                var first = (int)(s - dayStart).TotalMinutes / slotMinutes;
                var last = ((int)Math.Ceiling((e - dayStart).TotalMinutes) - 1) / slotMinutes;
                for (var i = first; i <= last && i < slotsPerDay; i++) slots[i] = true;
            }
        }

        static List<(int StartMinute, int EndMinute)> FreeRanges(List<bool[]> daySlots)
        {
            var threshold = daySlots.Count / 2 + 1;
            var ranges = new List<(int, int)>();
            for (var i = 0; i < slotsPerDay;)
            {
                if (daySlots.Count(d => !d[i]) < threshold) { i++; continue; }
                var startSlot = i;
                while (i < slotsPerDay && daySlots.Count(d => !d[i]) >= threshold) i++;
                ranges.Add((startSlot * slotMinutes, i * slotMinutes));
            }
            return ranges;
        }

        var ranges = new List<InsightsFreeRangeDto>();
        if (busyByDay.Count > 0)
        {
            var byWeekday = busyByDay
                .GroupBy(kv => kv.Key.DayOfWeek)
                .ToDictionary(g => g.Key, g => g.Select(kv => kv.Value).ToList());
            var fallback = FreeRanges(busyByDay.Values.ToList());

            for (var weekday = 0; weekday < 7; weekday++)
            {
                var dayRanges = byWeekday.TryGetValue((DayOfWeek)weekday, out var slots) && slots.Count >= minWeekdaySamples
                    ? FreeRanges(slots)
                    : fallback;
                ranges.AddRange(dayRanges.Select(r => new InsightsFreeRangeDto(weekday, r.StartMinute, r.EndMinute)));
            }
        }

        return new InsightsEmptyProfileDto(ranges);
    }
}
