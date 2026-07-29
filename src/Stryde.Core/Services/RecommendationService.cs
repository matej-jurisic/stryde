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

    /// <summary>Score multiplier when the activity's typical start time falls outside today's free slots.</summary>
    private const double StartTimeMismatchPenalty = 0.5;

    /// <summary>
    /// Span assumed for an activity with no completed history, when picking its slot. Must match
    /// DEFAULT_SUGGESTION_MINUTES on the calendar - the client draws an unknown-duration ghost this
    /// tall, so a slot chosen against a smaller figure would overhang the next event.
    /// </summary>
    private const int DefaultSuggestionMinutes = 30;

    /// <summary>
    /// How many suggestions may cover the same instant. Deliberately not 1: two ghosts side by side
    /// read as "pick one", which is useful. Past that the calendar columns get too narrow to read.
    /// </summary>
    private const int MaxConcurrentSuggestions = 2;

    /// <summary>Granularity of the candidate start times a suggestion is placed on.</summary>
    private const int PlacementStepMinutes = 15;

    /// <summary>
    /// Earliest local time a suggestion may land at when it has no habitual time to anchor to and
    /// its type's preferred window has no room left. The day boundary is usually the small hours,
    /// and a ghost at 04:00 is noise scrolled off the top of the grid. Ignored for today, where
    /// placement can't start before now anyway.
    /// </summary>
    private static readonly TimeOnly EarliestUnanchoredStart = new(8, 0);

    /// <param name="date">The day to recommend for; defaults to the user's current day.</param>
    /// <param name="nowUtc">Injectable clock for tests; defaults to the real time.</param>
    public async Task<List<RecommendationDto>> GetAsync(Guid userId, DateOnly? date = null, DateTimeOffset? nowUtc = null)
    {
        var now = nowUtc ?? DateTimeOffset.UtcNow;
        var ctx = await settings.GetDayContextAsync(userId);
        var currentDay = DayMath.Today(ctx, now);
        var today = date ?? currentDay;

        var allOccurrences = await db.Occurrences
            .AsNoTracking()
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

        // Per-day type caps count what is already on the day, not just what has been suggested:
        // once two deep work blocks are scheduled, a third suggestion is noise however it got there.
        var typeCounts = (await db.Activities
                .AsNoTracking()
                .Where(a => a.UserId == userId && todayActivityIds.Contains(a.Id))
                .Select(a => a.Type)
                .ToListAsync())
            .GroupBy(t => t)
            .ToDictionary(g => g.Key, g => g.Count());

        // Per-activity timing and cadence stats from windowed completed history
        var statsByActivity = completedHistory
            .GroupBy(o => o.ActivityId)
            .ToDictionary(g => g.Key, g => ComputeStats(g.ToList(), ctx));

        DateTimeOffset InstantForMinutes(int minutesFromMidnight)
        {
            // Minutes are from local midnight; times before the day boundary belong to the next calendar date
            var time = new TimeOnly(minutesFromMidnight / 60, minutesFromMidnight % 60);
            var calendarDate = time < ctx.DayBoundary ? today.AddDays(1) : today;
            var local = calendarDate.ToDateTime(time);
            return new DateTimeOffset(local, ctx.TimeZone.GetUtcOffset(local));
        }

        // Free time on the target day. For today: from now to end-of-day; for a future day: the
        // whole day. Null (past day) disables slot filtering — there is no time left to fill.
        List<(DateTimeOffset Start, DateTimeOffset End)>? freeSlots = null;
        var earliestUnanchored = default(DateTimeOffset);
        if (today >= currentDay)
        {
            var slotStart = today == currentDay ? now : DayMath.StartOfDay(today, ctx);
            // Done blocks still occupy their span - that time was spent, and the grid keeps drawing
            // them. Skipped ones don't: skipping is an explicit decision not to, so the time frees up.
            // Due pins (EndAt == null) are deadlines rather than commitments and never block.
            var dayBlocks = allOccurrences
                .Where(o => o.Status is EventStatus.pending or EventStatus.done)
                .Where(o => !IsFloating(o) && o.StartAt != null && o.EndAt != null && DayMath.OccurrenceDay(o, ctx) == today)
                .OrderBy(o => o.StartAt!.Value)
                .ToList();
            var endOfDay = DayMath.EndOfDay(today, ctx);
            freeSlots = ComputeFreeSlots(slotStart, endOfDay, dayBlocks);

            // Hold unanchored suggestions back to a sensible hour, unless that would push them out
            // of the day entirely (a day boundary late enough to swallow it).
            var civil = InstantForMinutes(EarliestUnanchoredStart.Hour * 60 + EarliestUnanchoredStart.Minute);
            earliestUnanchored = civil > slotStart && civil < endOfDay ? civil : slotStart;
        }

        // An activity needs a gap big enough for whichever is larger: what it usually takes, or the
        // floor its type declares. Zero on both sides means "no evidence, no floor" - let it through.
        bool FitsASlot(Guid activityId, ActivityType type)
        {
            if (freeSlots is null) return true;
            statsByActivity.TryGetValue(activityId, out var s);
            var needed = Math.Max(s?.DurationMinutes ?? 0, ActivityProfiles.For(type).MinBlockMinutes);
            if (needed == 0) return true;
            return freeSlots.Any(slot => (slot.End - slot.Start).TotalMinutes >= needed);
        }

        bool StartTimeIsFree(int minutesFromMidnight)
        {
            var instant = InstantForMinutes(minutesFromMidnight);
            return freeSlots!.Any(slot => instant >= slot.Start && instant < slot.End);
        }

        // Spans already handed to earlier (higher-ranked) suggestions. Placement consumes the day as
        // it goes, so suggestions spread out instead of every one of them picking the same first gap.
        var placedSpans = new List<(DateTimeOffset Start, DateTimeOffset End)>();

        bool CanPlace(DateTimeOffset start, int needed)
        {
            var end = start.AddMinutes(needed);
            if (!freeSlots!.Any(slot => start >= slot.Start && end <= slot.End)) return false;
            return placedSpans.Count(p => start < p.End && end > p.Start) < MaxConcurrentSuggestions;
        }

        // Every quarter-hour opening in the day's free time, in chronological order.
        IEnumerable<DateTimeOffset> CandidateStarts()
        {
            foreach (var slot in freeSlots!)
                for (var t = RoundUpToQuarter(slot.Start); t < slot.End; t = t.AddMinutes(PlacementStepMinutes))
                    yield return t;
        }

        // Where this activity goes on the target day, given what's already been placed: its habitual
        // time if that still fits, else the free opening nearest to it, else the first opening inside
        // its type's preferred window. Null when the day has no room left for it — which is the
        // point: it caps how many ghosts one gap can absorb, rather than stacking them on one slot.
        DateTimeOffset? PlaceActivity(Guid activityId, ActivityType type)
        {
            if (freeSlots is null) return null;
            statsByActivity.TryGetValue(activityId, out var s);
            var profile = ActivityProfiles.For(type);
            // No history means no median duration - assume the same span the calendar draws rather
            // than 0, which would "fit" any gap however small.
            var needed = Math.Max(s?.DurationMinutes ?? DefaultSuggestionMinutes, profile.MinBlockMinutes);

            DateTimeOffset? chosen;
            if (s?.StartMinutes is { } mins)
            {
                // Observed behaviour beats a declared preference: an activity that has a habitual
                // time keeps it even when the type's window says otherwise.
                var habitual = InstantForMinutes(mins);
                chosen = CanPlace(habitual, needed)
                    ? habitual
                    : CandidateStarts()
                        .Where(t => CanPlace(t, needed))
                        .OrderBy(t => Math.Abs((t - habitual).TotalMinutes))
                        .Cast<DateTimeOffset?>()
                        .FirstOrDefault();
            }
            else
            {
                // Preferred window first. It is a preference, not a constraint - an admin task on a
                // day whose afternoon is full still gets placed, just outside its window.
                var windowStart = InstantForMinutes(profile.WindowStart.Hour * 60 + profile.WindowStart.Minute);
                var windowEnd = InstantForMinutes(profile.WindowEnd.Hour * 60 + profile.WindowEnd.Minute);
                chosen = CandidateStarts()
                        .Where(t => t >= windowStart && t < windowEnd && CanPlace(t, needed))
                        .Cast<DateTimeOffset?>()
                        .FirstOrDefault()
                    ?? CandidateStarts()
                        .Where(t => t >= earliestUnanchored && CanPlace(t, needed))
                        .Cast<DateTimeOffset?>()
                        .FirstOrDefault();
            }

            if (chosen is { } c) placedSpans.Add((c, c.AddMinutes(needed)));
            return chosen;
        }

        // Overdueness relative to the activity's own rhythm: days since last completion divided by
        // the median gap between completions. >1 = past due, ~0 = just done (natural cooldown).
        double DueFraction(Activity activity)
        {
            statsByActivity.TryGetValue(activity.Id, out var s);
            var profile = ActivityProfiles.For(activity.Type);
            if (s is not null)
            {
                var daysSince = today.DayNumber - s.LastDoneDay.DayNumber;
                // One completion gives a last-done day but no gap; the type's prior stands in.
                var gap = Math.Max(s.MedianGapDays ?? profile.CadencePriorDays, 1.0);
                return daysSince / gap;
            }

            // Never completed, so overdueness is measured from creation instead. An activity added
            // today has not had a chance to be due yet; one added three weeks ago with a daily
            // cadence plainly is. Clamped, because none of this is actual evidence and an ancient
            // untouched activity would otherwise outrank everything with a real rhythm.
            var age = Math.Max(today.DayNumber - DayMath.DayOf(activity.CreatedAt, ctx).DayNumber, 0);
            return Math.Min(age / Math.Max(profile.CadencePriorDays, 1.0), ActivityProfiles.MaxColdStartScore);
        }

        // Ranking figure: due-ness, downranked when the typical start time falls in occupied time.
        double Score(Activity activity)
        {
            var score = DueFraction(activity);
            statsByActivity.TryGetValue(activity.Id, out var s);
            if (freeSlots is not null && s?.StartMinutes is { } mins && !StartTimeIsFree(mins))
                score *= StartTimeMismatchPenalty;
            return score;
        }

        // Cooldown. Due-ness only ever ranked; nothing gated on it, so an activity on a focus goal
        // was suggested every single day however recently it was done. A type declaring a
        // MinDueFraction is held back until the activity is that far through its own rhythm, which
        // is what puts rest days between sessions - and, since the measure is per activity, what
        // makes the other half of a split surface instead.
        bool PastCooldown(Activity activity)
        {
            var min = ActivityProfiles.For(activity.Type).MinDueFraction;
            // No completions means the figure would come from the creation date, which says nothing
            // about rest. A brand new activity is never in cooldown.
            if (min <= 0 || !statsByActivity.ContainsKey(activity.Id)) return true;
            return DueFraction(activity) >= min;
        }

        // Load all goal-linked activities for tiers 1/2
        var goalActivities = await db.Activities
            .AsNoTracking()
            .Include(a => a.Goal)
            .Include(a => a.Category)
            .Where(a => a.UserId == userId && !a.ExcludeFromRecommendations && a.Goal != null &&
                (a.Goal.Status == GoalStatus.focus || a.Goal.Status == GoalStatus.active))
            .ToListAsync();

        var goalTierActivities = new List<(int tier, Activity activity)>();
        var seenActivityIds = new HashSet<Guid>();

        void AddActivity(int tier, Activity activity)
        {
            if (seenActivityIds.Add(activity.Id) && !todayActivityIds.Contains(activity.Id)
                && FitsASlot(activity.Id, activity.Type) && PastCooldown(activity))
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

        // Only tier 3 activities carry a weekday pattern: goal-tier ones are already in
        // seenActivityIds by this point and were filtered out of the query above.
        var patternCountById = patternedActivityIds.ToDictionary(x => x.ActivityId, x => x.Count);

        List<Activity> habitRecs = [];
        if (patternedActivityIds.Count > 0)
        {
            var ids = patternedActivityIds.Select(x => x.ActivityId).ToList();
            var activities = await db.Activities
                .AsNoTracking()
                .Include(a => a.Category)
                .Include(a => a.Goal)
                .Where(a => ids.Contains(a.Id) && !a.ExcludeFromRecommendations)
                .ToListAsync();

            habitRecs = patternedActivityIds
                .Select(p => activities.FirstOrDefault(a => a.Id == p.ActivityId))
                .Where(a => a is not null && FitsASlot(a.Id, a.Type) && PastCooldown(a))
                .Select(a => a!)
                .ToList();
        }

        RecommendationDto MakeActivityRec(int tier, Activity activity)
        {
            statsByActivity.TryGetValue(activity.Id, out var s);
            patternCountById.TryGetValue(activity.Id, out var patternCount);
            return new RecommendationDto(
                tier, "activity", null, ActivityDto.FromEntity(activity), s?.DurationMinutes, s?.StartTime,
                s is null ? null : today.DayNumber - s.LastDoneDay.DayNumber,
                s?.MedianGapDays,
                patternCount == 0 ? null : patternCount,
                PlaceActivity(activity.Id, activity.Type));
        }

        // A type's MaxPerDay is a ceiling on the whole day, seeded with what is already scheduled.
        bool TakeTypeSlot(ActivityType type)
        {
            var max = ActivityProfiles.For(type).MaxPerDay;
            typeCounts.TryGetValue(type, out var used);
            if (max > 0 && used >= max) return false;
            typeCounts[type] = used + 1;
            return true;
        }

        var result = new List<RecommendationDto>();

        // Tiers 1/2 rank by overdueness within the tier; tier 3 keeps its frequency order (spec).
        // Order is materialised first because placement is stateful - each suggestion consumes the
        // gap it takes, so the best-ranked activity must get first pick of the day. The type cap is
        // checked in the same pass and before MakeActivityRec, so a capped-out activity does not
        // consume a slot on its way to being dropped.
        var ranked = goalTierActivities
            .OrderBy(x => x.tier).ThenByDescending(x => Score(x.activity))
            .ToList();

        foreach (var (tier, activity) in ranked)
            if (TakeTypeSlot(activity.Type))
                result.Add(MakeActivityRec(tier, activity));

        foreach (var a in habitRecs)
            if (TakeTypeSlot(a.Type))
                result.Add(MakeActivityRec(3, a));

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

    /// <summary>Next quarter hour at or after <paramref name="t"/>, so suggested times read cleanly.</summary>
    private static DateTimeOffset RoundUpToQuarter(DateTimeOffset t)
    {
        var truncated = new DateTimeOffset(t.Year, t.Month, t.Day, t.Hour, t.Minute, 0, t.Offset);
        if (truncated < t) truncated = truncated.AddMinutes(1);
        var remainder = truncated.Minute % 15;
        return remainder == 0 ? truncated : truncated.AddMinutes(15 - remainder);
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
