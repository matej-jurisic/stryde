using Microsoft.EntityFrameworkCore;
using Stryde.Core.Data;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;
using Stryde.Core.Enums;

namespace Stryde.Core.Services;

public class RecommendationService(StrydeDbContext db)
{
    public async Task<List<RecommendationDto>> GetAsync(Guid userId, DateOnly date)
    {
        var events = await db.Events
            .Include(e => e.Goals)
            .Where(e => e.UserId == userId && e.Status == EventStatus.pending)
            .ToListAsync();

        var now = DateTime.UtcNow;

        bool IsDueToday(Event e)
        {
            if (e.StartAt == null) return false;
            return DateOnly.FromDateTime(e.StartAt.Value.UtcDateTime) == date;
        }

        bool IsOverdue(Event e)
        {
            if (e.StartAt == null) return false;
            if (DateOnly.FromDateTime(e.StartAt.Value.UtcDateTime) >= date) return false;
            if (e.EndAt.HasValue) return e.EndAt.Value.UtcDateTime < now;
            // StartAt-only: overdue after midnight of the start date
            return e.StartAt.Value.UtcDateTime.Date.AddDays(1) < now;
        }

        bool IsFloating(Event e) => e.StartAt == null;

        var result = new List<(int tier, Event e)>();
        var seen = new HashSet<Guid>();

        void Add(int tier, Event e)
        {
            if (seen.Add(e.Id))
                result.Add((tier, e));
        }

        // Tier 1: due today
        foreach (var e in events.Where(IsDueToday))
            Add(1, e);

        // Tier 2: overdue (not already captured in tier 1)
        foreach (var e in events.Where(IsOverdue))
            Add(2, e);

        // Tiers 3 & 4: scheduled events linked to focus/active goals.
        // "Lagging" filter is deferred to Phase 10 when the fixed progress increment is defined;
        // for now, all pending scheduled events linked to focus/active goals qualify.
        foreach (var e in events.Where(ev => !IsFloating(ev) && !IsDueToday(ev) && !IsOverdue(ev)))
        {
            if (e.Goals.Any(g => g.Status == GoalStatus.focus))
                Add(3, e);
            else if (e.Goals.Any(g => g.Status == GoalStatus.active))
                Add(4, e);
        }

        // Tiers 5 & 6: floating events linked to focus/active goals
        foreach (var e in events.Where(IsFloating))
        {
            if (e.Goals.Any(g => g.Status == GoalStatus.focus))
                Add(5, e);
            else if (e.Goals.Any(g => g.Status == GoalStatus.active))
                Add(6, e);
        }

        // Tier 7: floating events linked to bench goals — only when tiers 1-6 are empty
        if (result.Count == 0)
        {
            foreach (var e in events.Where(IsFloating))
            {
                if (e.Goals.Any(g => g.Status == GoalStatus.bench))
                    Add(7, e);
            }
        }

        static DateTimeOffset SortDate(Event e) =>
            e.EndAt ?? e.StartAt ?? DateTimeOffset.MaxValue;

        static double Duration(Event e) =>
            e.StartAt.HasValue && e.EndAt.HasValue
                ? (e.EndAt.Value - e.StartAt.Value).TotalMinutes
                : double.MaxValue;

        return result
            .OrderBy(x => x.tier)
            .ThenBy(x => SortDate(x.e))
            .ThenBy(x => Duration(x.e))
            .Select(x => new RecommendationDto(x.tier, EventDto.FromEntity(x.e)))
            .ToList();
    }
}
