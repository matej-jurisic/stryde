using Microsoft.EntityFrameworkCore;
using Stryde.Core.Common;
using Stryde.Core.Data;
using Stryde.Core.Dtos;
using Stryde.Core.Enums;

namespace Stryde.Core.Services;

public class InsightsService(StrydeDbContext db, UserSettingsService settings)
{
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

        static int? DurationOf(Entities.Occurrence o) =>
            o.StartAt.HasValue && o.EndAt.HasValue
                ? (int)(o.EndAt.Value - o.StartAt.Value).TotalMinutes
                : o.DurationMinutes;

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
        Dictionary<DateOnly, int> TrackedByDay(DateOnly from, DateOnly to) => completed
            .Select(o => (Day: DayMath.DayOf(o.StartAt!.Value, ctx), Minutes: DurationOf(o)))
            .Where(x => x.Minutes is > 0 && x.Day >= from && x.Day <= to)
            .GroupBy(x => x.Day)
            .ToDictionary(g => g.Key, g => g.Sum(x => x.Minutes!.Value));

        static int? AvgUnaccounted(Dictionary<DateOnly, int> byDay) => byDay.Count > 0
            ? (int)byDay.Values.Select(m => Math.Max(0, 1440 - m)).Average()
            : null;

        var trackedByDay = TrackedByDay(windowStart, today);
        var prevTrackedByDay = TrackedByDay(windowStart.AddDays(-windowDays), windowStart.AddDays(-1));

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
}
