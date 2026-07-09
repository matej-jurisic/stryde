using Microsoft.EntityFrameworkCore;
using Stryde.Core.Common;
using Stryde.Core.Data;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;
using Stryde.Core.Enums;

namespace Stryde.Core.Services;

public class RecommendationService(StrydeDbContext db, UserSettingsService settings)
{
    /// <param name="date">The day to recommend for; defaults to the user's current day.</param>
    /// <param name="nowUtc">Injectable clock for tests; defaults to the real time.</param>
    public async Task<List<RecommendationDto>> GetAsync(Guid userId, DateOnly? date = null, DateTimeOffset? nowUtc = null)
    {
        var now = nowUtc ?? DateTimeOffset.UtcNow;
        var ctx = await settings.GetDayContextAsync(userId);
        var today = date ?? DayMath.Today(ctx, now);

        var allOccurrences = await db.Occurrences
            .Include(o => o.Activity).ThenInclude(a => a.Goal)
            .Include(o => o.Activity).ThenInclude(a => a.Category)
            .Where(o => o.UserId == userId)
            .ToListAsync();

        var pendingOccurrences = allOccurrences.Where(o => o.Status == EventStatus.pending).ToList();
        var recentCompleted = allOccurrences
            .Where(o => o.Status == EventStatus.done && o.StartAt != null)
            .ToList();

        bool IsFloating(Occurrence o) => o.StartAt == null && o.WindowStart == null;

        // ActivityIds already on today's schedule — excluded from pattern suggestions
        var todayActivityIds = pendingOccurrences
            .Where(o => !IsFloating(o) && DayMath.OccurrenceDay(o, ctx) == today)
            .Select(o => o.ActivityId)
            .ToHashSet();

        var occurrenceRecs = new List<(int tier, Occurrence o)>();
        var seenIds = new HashSet<Guid>();

        void AddOccurrence(int tier, Occurrence o)
        {
            if (seenIds.Add(o.Id))
                occurrenceRecs.Add((tier, o));
        }

        // Tier 1: floating occurrences linked to Focus goals
        foreach (var o in pendingOccurrences.Where(IsFloating))
            if (o.Activity.Goal?.Status == GoalStatus.focus)
                AddOccurrence(1, o);

        // Tier 2: floating occurrences linked to Active goals
        foreach (var o in pendingOccurrences.Where(IsFloating))
            if (o.Activity.Goal?.Status == GoalStatus.active)
                AddOccurrence(2, o);

        // Tier 3: Activities with a day-of-week pattern (>=2 completions on today's weekday in past 6 weeks)
        var todayDow = today.DayOfWeek;

        var patternedActivityIds = recentCompleted
            .Where(o => o.StartAt!.Value >= now.AddDays(-42))
            .GroupBy(o => o.ActivityId)
            .Select(g => new
            {
                ActivityId = g.Key,
                Count = g.Count(o => DayMath.DayOf(o.StartAt!.Value, ctx).DayOfWeek == todayDow)
            })
            .Where(x => x.Count >= 2 && !todayActivityIds.Contains(x.ActivityId))
            .OrderByDescending(x => x.Count)
            .ToList();

        List<ActivityDto> activityRecs = [];
        if (patternedActivityIds.Count > 0)
        {
            var ids = patternedActivityIds.Select(x => x.ActivityId).ToList();
            var activities = await db.Activities
                .Include(a => a.Category)
                .Include(a => a.Goal)
                .Where(a => ids.Contains(a.Id))
                .ToListAsync();

            activityRecs = patternedActivityIds
                .Select(p => activities.FirstOrDefault(a => a.Id == p.ActivityId))
                .Where(a => a is not null)
                .Select(a => ActivityDto.FromEntity(a!))
                .ToList();
        }

        // Tier 4: floating occurrences linked to Bench goals — only when tiers 1-3 are all empty
        if (occurrenceRecs.Count == 0 && activityRecs.Count == 0)
        {
            foreach (var o in pendingOccurrences.Where(IsFloating))
                if (o.Activity.Goal?.Status == GoalStatus.bench)
                    AddOccurrence(4, o);
        }

        static DateTimeOffset SortDate(Occurrence o) => o.EndAt ?? o.StartAt ?? DateTimeOffset.MaxValue;
        static double Duration(Occurrence o) =>
            o.StartAt.HasValue && o.EndAt.HasValue
                ? (o.EndAt.Value - o.StartAt.Value).TotalMinutes
                : double.MaxValue;

        var result = new List<RecommendationDto>();

        foreach (var (tier, o) in occurrenceRecs.Where(x => x.tier < 3)
                     .OrderBy(x => x.tier).ThenBy(x => SortDate(x.o)).ThenBy(x => Duration(x.o)))
            result.Add(new RecommendationDto(tier, "occurrence", OccurrenceDto.FromEntity(o, ctx, now), null));

        foreach (var a in activityRecs)
            result.Add(new RecommendationDto(3, "activity", null, a));

        foreach (var (tier, o) in occurrenceRecs.Where(x => x.tier == 4)
                     .OrderBy(x => SortDate(x.o)).ThenBy(x => Duration(x.o)))
            result.Add(new RecommendationDto(tier, "occurrence", OccurrenceDto.FromEntity(o, ctx, now), null));

        return result;
    }
}
