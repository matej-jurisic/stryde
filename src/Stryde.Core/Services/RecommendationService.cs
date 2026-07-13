using Microsoft.EntityFrameworkCore;
using Stryde.Core.Common;
using Stryde.Core.Data;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;
using Stryde.Core.Enums;

namespace Stryde.Core.Services;

public class RecommendationService(StrydeDbContext db, UserSettingsService settings)
{
    /// <summary>Completed history older than this feeds neither timing hints nor cadence.</summary>
    private const int HistoryWindowDays = 90;

    /// <summary>Tier 3 weekday-pattern window.</summary>
    private const int PatternWindowDays = 42;

    /// <summary>Assumed cadence for activities with a single completion (can't derive a gap yet).</summary>
    private const double DefaultCadenceDays = 7.0;

    /// <summary>Score multiplier when the activity's typical start time falls outside today's free slots.</summary>
    private const double StartTimeMismatchPenalty = 0.5;

    /// <param name="date">The day to recommend for; defaults to the user's current day.</param>
    /// <param name="nowUtc">Injectable clock for tests; defaults to the real time.</param>
    public async Task<List<RecommendationDto>> GetAsync(Guid userId, DateOnly? date = null, DateTimeOffset? nowUtc = null)
    {
        var now = nowUtc ?? DateTimeOffset.UtcNow;
        var ctx = await settings.GetDayContextAsync(userId);
        var currentDay = DayMath.Today(ctx, now);
        var today = date ?? currentDay;

        var allOccurrences = await db.Occurrences
            .Where(o => o.UserId == userId)
            .ToListAsync();

        var pendingOccurrences = allOccurrences.Where(o => o.Status == EventStatus.pending).ToList();
        var historyCutoff = now.AddDays(-HistoryWindowDays);
        var completedHistory = allOccurrences
            .Where(o => o.Status == EventStatus.done && o.StartAt != null && o.StartAt.Value >= historyCutoff)
            .ToList();

        bool IsFloating(Occurrence o) => !o.IsPlanned && o.StartAt == null && o.EndAt == null && !o.IsAllDay;

        // ActivityIds already on today's schedule — excluded from all suggestions
        var todayActivityIds = pendingOccurrences
            .Where(o => !IsFloating(o) && DayMath.OccurrenceDay(o, ctx) == today)
            .Select(o => o.ActivityId)
            .ToHashSet();

        // Per-activity timing and cadence stats from windowed completed history
        var statsByActivity = completedHistory
            .GroupBy(o => o.ActivityId)
            .ToDictionary(g => g.Key, g => ComputeStats(g.ToList(), ctx));

        // Free time on the target day. For today: from now to end-of-day; for a future day: the
        // whole day. Null (past day) disables slot filtering — there is no time left to fill.
        List<(DateTimeOffset Start, DateTimeOffset End)>? freeSlots = null;
        if (today >= currentDay)
        {
            var slotStart = today == currentDay ? now : DayMath.StartOfDay(today, ctx);
            var dayBlocks = pendingOccurrences
                .Where(o => !IsFloating(o) && o.StartAt != null && o.EndAt != null && DayMath.OccurrenceDay(o, ctx) == today)
                .OrderBy(o => o.StartAt!.Value)
                .ToList();
            freeSlots = ComputeFreeSlots(slotStart, DayMath.EndOfDay(today, ctx), dayBlocks);
        }

        bool FitsASlot(Guid activityId)
        {
            if (freeSlots is null) return true;
            if (!statsByActivity.TryGetValue(activityId, out var s)) return true;
            if (s.DurationMinutes is null or 0) return true;
            return freeSlots.Any(slot => (slot.End - slot.Start).TotalMinutes >= s.DurationMinutes.Value);
        }

        bool StartTimeIsFree(int minutesFromMidnight)
        {
            // Minutes are from local midnight; times before the day boundary belong to the next calendar date
            var time = new TimeOnly(minutesFromMidnight / 60, minutesFromMidnight % 60);
            var calendarDate = time < ctx.DayBoundary ? today.AddDays(1) : today;
            var local = calendarDate.ToDateTime(time);
            var instant = new DateTimeOffset(local, ctx.TimeZone.GetUtcOffset(local));
            return freeSlots!.Any(slot => instant >= slot.Start && instant < slot.End);
        }

        // Overdueness relative to the activity's own rhythm: days since last completion divided by
        // the median gap between completions. >1 = past due, ~0 = just done (natural cooldown).
        // No history = neutral 1. Downranked when the typical start time falls in occupied time.
        double Score(Guid activityId)
        {
            statsByActivity.TryGetValue(activityId, out var s);
            var score = 1.0;
            if (s is not null)
            {
                var daysSince = today.DayNumber - s.LastDoneDay.DayNumber;
                var gap = Math.Max(s.MedianGapDays ?? DefaultCadenceDays, 1.0);
                score = daysSince / gap;
            }
            if (freeSlots is not null && s?.StartMinutes is { } mins && !StartTimeIsFree(mins))
                score *= StartTimeMismatchPenalty;
            return score;
        }

        // Load all goal-linked activities for tiers 1/2/4
        var goalActivities = await db.Activities
            .Include(a => a.Goal)
            .Include(a => a.Category)
            .Where(a => a.UserId == userId && a.Goal != null &&
                (a.Goal.Status == GoalStatus.focus || a.Goal.Status == GoalStatus.active || a.Goal.Status == GoalStatus.bench))
            .ToListAsync();

        var goalTierActivities = new List<(int tier, Activity activity)>();
        var seenActivityIds = new HashSet<Guid>();

        void AddActivity(int tier, Activity activity)
        {
            if (seenActivityIds.Add(activity.Id) && !todayActivityIds.Contains(activity.Id) && FitsASlot(activity.Id))
                goalTierActivities.Add((tier, activity));
        }

        foreach (var a in goalActivities.Where(a => a.Goal!.Status == GoalStatus.focus))
            AddActivity(1, a);

        foreach (var a in goalActivities.Where(a => a.Goal!.Status == GoalStatus.active))
            AddActivity(2, a);

        // Tier 3: Activities with a day-of-week pattern (>=2 completions on today's weekday in past 6 weeks)
        var todayDow = today.DayOfWeek;

        var patternedActivityIds = completedHistory
            .Where(o => o.StartAt!.Value >= now.AddDays(-PatternWindowDays))
            .GroupBy(o => o.ActivityId)
            .Select(g => new
            {
                ActivityId = g.Key,
                Count = g.Count(o => DayMath.DayOf(o.StartAt!.Value, ctx).DayOfWeek == todayDow)
            })
            .Where(x => x.Count >= 2 && !todayActivityIds.Contains(x.ActivityId) && !seenActivityIds.Contains(x.ActivityId))
            .OrderByDescending(x => x.Count)
            .ToList();

        List<ActivityDto> habitRecs = [];
        if (patternedActivityIds.Count > 0)
        {
            var ids = patternedActivityIds.Select(x => x.ActivityId).ToList();
            var activities = await db.Activities
                .Include(a => a.Category)
                .Include(a => a.Goal)
                .Where(a => ids.Contains(a.Id))
                .ToListAsync();

            habitRecs = patternedActivityIds
                .Where(p => FitsASlot(p.ActivityId))
                .Select(p => activities.FirstOrDefault(a => a.Id == p.ActivityId))
                .Where(a => a is not null)
                .Select(a => ActivityDto.FromEntity(a!))
                .ToList();
        }

        // Tier 4: bench goal activities — only when tiers 1-3 are all empty
        if (goalTierActivities.Count == 0 && habitRecs.Count == 0)
        {
            foreach (var a in goalActivities.Where(a => a.Goal!.Status == GoalStatus.bench))
                AddActivity(4, a);
        }

        RecommendationDto MakeActivityRec(int tier, Guid activityId, ActivityDto dto)
        {
            statsByActivity.TryGetValue(activityId, out var s);
            return new RecommendationDto(tier, "activity", null, dto, s?.DurationMinutes, s?.StartTime);
        }

        var result = new List<RecommendationDto>();

        // Tiers 1/2/4 rank by overdueness within the tier; tier 3 keeps its frequency order (spec).
        foreach (var (tier, activity) in goalTierActivities.Where(x => x.tier < 3)
            .OrderBy(x => x.tier).ThenByDescending(x => Score(x.activity.Id)))
            result.Add(MakeActivityRec(tier, activity.Id, ActivityDto.FromEntity(activity)));

        foreach (var a in habitRecs)
            result.Add(MakeActivityRec(3, a.Id, a));

        foreach (var (tier, activity) in goalTierActivities.Where(x => x.tier == 4)
            .OrderByDescending(x => Score(x.activity.Id)))
            result.Add(MakeActivityRec(tier, activity.Id, ActivityDto.FromEntity(activity)));

        return result;
    }

    /// <summary>Per-activity stats derived from windowed completed occurrences (all have StartAt).</summary>
    private sealed record ActivityStats(
        int? DurationMinutes, string? StartTime, int? StartMinutes, DateOnly LastDoneDay, double? MedianGapDays);

    private static ActivityStats ComputeStats(List<Occurrence> completed, DayContext ctx)
    {
        var durations = completed
            .Select(o => o.DurationMinutes is > 0
                ? (double?)o.DurationMinutes.Value
                : o.StartAt.HasValue && o.EndAt.HasValue
                    ? (o.EndAt.Value - o.StartAt.Value).TotalMinutes
                    : null)
            .Where(d => d is > 0)
            .Select(d => d!.Value)
            .OrderBy(d => d)
            .ToList();

        int? medianDuration = durations.Count > 0
            ? (int)Math.Round(durations[durations.Count / 2])
            : null;

        // Most common start time rounded to nearest 15 min, in user's timezone
        var modeMinutes = completed
            .Select(o =>
            {
                var local = TimeZoneInfo.ConvertTime(o.StartAt!.Value, ctx.TimeZone);
                var total = local.Hour * 60 + local.Minute;
                return ((total + 7) / 15) * 15 % (24 * 60);
            })
            .GroupBy(m => m)
            .OrderByDescending(g => g.Count())
            .Select(g => (int?)g.Key)
            .FirstOrDefault();

        string? typicalStartTime = modeMinutes.HasValue
            ? $"{modeMinutes.Value / 60:D2}:{modeMinutes.Value % 60:D2}"
            : null;

        // Cadence: median gap in days between distinct completion days
        var doneDays = completed
            .Select(o => DayMath.DayOf(o.StartAt!.Value, ctx))
            .Distinct()
            .OrderBy(d => d.DayNumber)
            .ToList();

        double? medianGap = null;
        if (doneDays.Count >= 2)
        {
            var gaps = doneDays.Skip(1)
                .Select((d, i) => (double)(d.DayNumber - doneDays[i].DayNumber))
                .OrderBy(g => g)
                .ToList();
            medianGap = gaps[gaps.Count / 2];
        }

        return new ActivityStats(medianDuration, typicalStartTime, modeMinutes, doneDays[^1], medianGap);
    }

    private static List<(DateTimeOffset Start, DateTimeOffset End)> ComputeFreeSlots(
        DateTimeOffset from, DateTimeOffset to, List<Occurrence> blocks)
    {
        var slots = new List<(DateTimeOffset, DateTimeOffset)>();
        if (from >= to) return slots;

        var cursor = from;
        foreach (var o in blocks)
        {
            if (o.StartAt!.Value > cursor)
                slots.Add((cursor, o.StartAt.Value));
            if (o.EndAt!.Value > cursor)
                cursor = o.EndAt!.Value;
        }
        if (cursor < to)
            slots.Add((cursor, to));

        return slots;
    }
}
