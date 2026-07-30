using Microsoft.EntityFrameworkCore;
using Stryde.Core.Common;
using Stryde.Core.Data;
using Stryde.Core.Dtos;
using Stryde.Core.Enums;

namespace Stryde.Core.Services;

public class InsightsService(StrydeDbContext db, UserSettingsService settings, StateService states)
{
    /// <summary>
    /// One tracked day, analysed. <paramref name="CountedMinutes"/> is how much of it the unaccounted
    /// -time mask lets through: zero drops the day from the stats entirely, because a day that was
    /// never the user's to spend has nothing to say about how they spent it.
    /// </summary>
    private sealed record DayAnalysis(
        DateOnly Day,
        DateTimeOffset Start,
        DateTimeOffset End,
        int CountedMinutes,
        List<(DateTimeOffset Start, DateTimeOffset End)> Empty);

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
            .AsNoTracking()
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

        // Everything below reads one day at a time, and all three stats - the average, the biggest
        // gaps, the often-empty hours - are the same measurement at different resolutions: which
        // stretches of a day counted and had nothing in them.
        //
        // Today is excluded (still in progress, its remaining hours would read as unaccounted): the
        // window is the windowDays full days before today, and the previous window shifts back.
        var trackedEnd = today.AddDays(-1);

        // A day is tracked when at least one completed timed occurrence starts on it. Busy intervals
        // come from all completed occurrences regardless of day, so an overnight span covers the
        // following morning.
        HashSet<DateOnly> TrackedDays(DateOnly from, DateOnly to) => completed
            .Select(o => (Day: DayMath.DayOf(o.StartAt!.Value, ctx), Minutes: DurationOf(o)))
            .Where(x => x.Minutes is > 0 && x.Day >= from && x.Day <= to)
            .Select(x => x.Day)
            .ToHashSet();

        var intervals = completed
            .Select(o => (Start: o.StartAt!.Value, Minutes: DurationOf(o)))
            .Where(x => x.Minutes is > 0)
            .Select(x => (x.Start, End: x.Start.AddMinutes(x.Minutes!.Value)))
            .ToList();

        // The unaccounted-time mask: the state values that make a stretch of the day count at all.
        // Empty for an account that has not configured one, and the whole state machinery is skipped
        // then - which is every account by default.
        var mask = await settings.GetUnaccountedMaskAsync(userId);
        var stateContext = StateContext.Empty;
        if (mask.Count > 0)
        {
            // Setters are read off the whole schedule, not just done rows: a state is a reading of the
            // calendar (see spec.md -> States), and a pending occurrence still says where you were.
            var all = await db.Occurrences.AsNoTracking().Where(o => o.UserId == userId).ToListAsync();
            stateContext = await states.LoadContextAsync(userId, all);
            // A state deleted since the mask was set leaves rows behind pointing at nothing; dropping
            // them here means the mask loosens rather than silencing every day.
            mask = mask.Where(g => stateContext.Timelines.ContainsKey(g.StateId)).ToList();
        }

        DayAnalysis Analyse(DateOnly day)
        {
            var dayStart = DayMath.StartOfDay(day, ctx);
            var dayEnd = DayMath.EndOfDay(day, ctx);

            List<(DateTimeOffset Start, DateTimeOffset End)> counted = [(dayStart, dayEnd)];
            foreach (var (stateId, allowed) in mask)
                counted = Intervals.Intersect(
                    counted, stateContext.Timelines[stateId].IntervalsWhere(allowed, dayStart, dayEnd));

            // Time the mask excludes is folded in with the busy spans rather than handled separately:
            // it is neither empty nor available, so it should disappear from every stat at once.
            var blocked = Intervals.Merge(intervals
                .Where(x => x.End > dayStart && x.Start < dayEnd)
                .Select(x => (Start: x.Start < dayStart ? dayStart : x.Start, End: x.End > dayEnd ? dayEnd : x.End))
                .Concat(Intervals.Complement(counted, dayStart, dayEnd)));

            return new DayAnalysis(
                day, dayStart, dayEnd,
                (int)counted.Sum(c => (c.End - c.Start).TotalMinutes),
                Intervals.Complement(blocked, dayStart, dayEnd));
        }

        // Days the mask lets nothing through are dropped, not scored as zero: a week away from home
        // would otherwise pull the average down as if every hour of it had been spent well.
        // Ordered so gaps of equal length always come back in the same order rather than in whatever
        // order the set enumerated.
        List<DayAnalysis> AnalyseWindow(DateOnly from, DateOnly to) => TrackedDays(from, to)
            .OrderBy(d => d)
            .Select(Analyse)
            .Where(d => d.CountedMinutes > 0)
            .ToList();

        static int EmptyMinutes(DayAnalysis d) => (int)d.Empty.Sum(e => (e.End - e.Start).TotalMinutes);

        static int? AvgUnaccounted(List<DayAnalysis> days) =>
            days.Count > 0 ? (int)days.Select(EmptyMinutes).Average() : null;

        var trackedDays = AnalyseWindow(trackedEnd.AddDays(-(windowDays - 1)), trackedEnd);
        var prevTrackedDays = AnalyseWindow(trackedEnd.AddDays(-(2 * windowDays - 1)), trackedEnd.AddDays(-windowDays));

        string LocalClock(DateTimeOffset instant) =>
            TimeZoneInfo.ConvertTime(instant, ctx.TimeZone).ToString("HH:mm");

        var largestGaps = trackedDays
            .SelectMany(d => d.Empty.Select(e => new InsightsGapDto(
                d.Day.ToString("O"), LocalClock(e.Start), LocalClock(e.End), (int)(e.End - e.Start).TotalMinutes)))
            .OrderByDescending(g => g.Minutes)
            .Take(5)
            .ToList();

        var slotEmptyDays = new int[24];
        foreach (var d in trackedDays)
            for (var i = 0; i < 24; i++)
            {
                var slotStart = d.Start.AddHours(i);
                var slotEnd = slotStart.AddHours(1);
                if (slotStart >= d.End) break;
                if (slotEnd > d.End) slotEnd = d.End;
                // Fully inside one empty stretch, which is the same test as "no blocked span overlaps
                // it" - Empty is that set's complement.
                if (d.Empty.Any(e => e.Start <= slotStart && e.End >= slotEnd)) slotEmptyDays[i]++;
            }

        // Unused blocks: maximal runs of consecutive hour slots empty on a strict majority of tracked days.
        var runs = new List<(InsightsUnusedBlockDto Block, int Hours)>();
        var threshold = trackedDays.Count / 2 + 1;
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
                trackedDays.Count), i - start));
        }
        var unusedBlocks = runs
            .OrderByDescending(r => r.Block.EmptyDays)
            .ThenByDescending(r => r.Hours)
            .Take(3)
            .Select(r => r.Block)
            .ToList();

        return new InsightsDto(
            activities, categories,
            AvgUnaccounted(trackedDays), AvgUnaccounted(prevTrackedDays),
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
            .AsNoTracking()
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
