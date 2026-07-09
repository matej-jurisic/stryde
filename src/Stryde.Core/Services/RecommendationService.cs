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

        // Single query for all user events — filter pending vs. completed in memory
        var allEvents = await db.Events
            .Include(e => e.Goals)
            .Include(e => e.Category)
            .Where(e => e.UserId == userId)
            .ToListAsync();

        var pendingEvents = allEvents.Where(e => e.Status == EventStatus.pending).ToList();
        var recentCompleted = allEvents
            .Where(e => e.Status == EventStatus.done && e.BaseEventId.HasValue && e.StartAt != null)
            .ToList();

        bool IsFloating(Event e) => e.StartAt == null;

        // BaseEventIds already on today's schedule — excluded from pattern suggestions
        var todayBaseEventIds = pendingEvents
            .Where(e => !IsFloating(e) && DayMath.EventDay(e, ctx) == today && e.BaseEventId.HasValue)
            .Select(e => e.BaseEventId!.Value)
            .ToHashSet();

        var eventRecs = new List<(int tier, Event e)>();
        var seenEventIds = new HashSet<Guid>();

        void AddEvent(int tier, Event e)
        {
            if (seenEventIds.Add(e.Id))
                eventRecs.Add((tier, e));
        }

        // Tier 1: floating events linked to Focus goals
        foreach (var e in pendingEvents.Where(IsFloating))
            if (e.Goals.Any(g => g.Status == GoalStatus.focus))
                AddEvent(1, e);

        // Tier 2: floating events linked to Active goals
        foreach (var e in pendingEvents.Where(IsFloating))
            if (e.Goals.Any(g => g.Status == GoalStatus.active))
                AddEvent(2, e);

        // Tier 3: BaseEvents with a day-of-week pattern (≥2 completions on today's weekday in past 6 weeks)
        var todayDow = today.DayOfWeek;

        var patternedBaseEventIds = recentCompleted
            .Where(e => e.StartAt!.Value >= now.AddDays(-42))
            .GroupBy(e => e.BaseEventId!.Value)
            .Select(g => new { BaseEventId = g.Key, Count = g.Count(e => DayMath.DayOf(e.StartAt!.Value, ctx).DayOfWeek == todayDow) })
            .Where(x => x.Count >= 2 && !todayBaseEventIds.Contains(x.BaseEventId))
            .OrderByDescending(x => x.Count)
            .ToList();

        List<BaseEventSummaryDto> baseEventRecs = [];
        if (patternedBaseEventIds.Count > 0)
        {
            var ids = patternedBaseEventIds.Select(x => x.BaseEventId).ToList();
            var baseEvents = await db.BaseEvents
                .Include(b => b.Category)
                .Include(b => b.Goal)
                .Where(b => ids.Contains(b.Id))
                .ToListAsync();

            baseEventRecs = patternedBaseEventIds
                .Select(p => baseEvents.FirstOrDefault(b => b.Id == p.BaseEventId))
                .Where(b => b is not null)
                .Select(b => BaseEventSummaryDto.FromEntity(b!))
                .ToList();
        }

        // Tier 4: floating events linked to Bench goals — only when tiers 1-3 are all empty
        if (eventRecs.Count == 0 && baseEventRecs.Count == 0)
        {
            foreach (var e in pendingEvents.Where(IsFloating))
                if (e.Goals.Any(g => g.Status == GoalStatus.bench))
                    AddEvent(4, e);
        }

        static DateTimeOffset SortDate(Event e) => e.EndAt ?? e.StartAt ?? DateTimeOffset.MaxValue;
        static double Duration(Event e) =>
            e.StartAt.HasValue && e.EndAt.HasValue
                ? (e.EndAt.Value - e.StartAt.Value).TotalMinutes
                : double.MaxValue;

        var result = new List<RecommendationDto>();

        // Tiers 1 and 2 (event type), sorted by date then duration within each tier
        foreach (var (tier, e) in eventRecs.Where(x => x.tier < 3)
                     .OrderBy(x => x.tier).ThenBy(x => SortDate(x.e)).ThenBy(x => Duration(x.e)))
            result.Add(new RecommendationDto(tier, "event", EventDto.FromEntity(e, ctx, now), null));

        // Tier 3 (base_event pattern), already in frequency-desc order
        foreach (var be in baseEventRecs)
            result.Add(new RecommendationDto(3, "base_event", null, be));

        // Tier 4 (bench fallback), sorted by date then duration
        foreach (var (tier, e) in eventRecs.Where(x => x.tier == 4)
                     .OrderBy(x => SortDate(x.e)).ThenBy(x => Duration(x.e)))
            result.Add(new RecommendationDto(tier, "event", EventDto.FromEntity(e, ctx, now), null));

        return result;
    }
}
