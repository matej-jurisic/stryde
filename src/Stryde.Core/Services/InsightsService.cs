using Microsoft.EntityFrameworkCore;
using Stryde.Core.Common;
using Stryde.Core.Data;
using Stryde.Core.Dtos;
using Stryde.Core.Enums;

namespace Stryde.Core.Services;

public class InsightsService(StrydeDbContext db, UserSettingsService settings)
{
    /// <summary>Length of the per-day completion chart.</summary>
    private const int ChartDays = 14;

    /// <summary>Window for the category breakdown and the 30-day total.</summary>
    private const int BreakdownWindowDays = 30;

    /// <param name="nowUtc">Injectable clock for tests; defaults to the real time.</param>
    public async Task<InsightsDto> GetAsync(Guid userId, DateTimeOffset? nowUtc = null)
    {
        var now = nowUtc ?? DateTimeOffset.UtcNow;
        var ctx = await settings.GetDayContextAsync(userId);
        var today = DayMath.Today(ctx, now);

        // Only dated completions count: a floating occurrence has no day to bucket into.
        // Day filtering happens in memory, consistent with the rest of the day math.
        var completed = await db.Occurrences
            .Include(o => o.Activity).ThenInclude(a => a.Category)
            .Where(o => o.UserId == userId && o.Status == EventStatus.done && o.StartAt != null)
            .ToListAsync();

        var byDay = completed
            .GroupBy(o => DayMath.DayOf(o.StartAt!.Value, ctx))
            .ToDictionary(g => g.Key, g => g.ToList());

        int DoneOn(DateOnly day) => byDay.TryGetValue(day, out var list) ? list.Count : 0;

        int DoneSince(DateOnly from) =>
            byDay.Where(kv => kv.Key >= from && kv.Key <= today).Sum(kv => kv.Value.Count);

        var days = new List<InsightsDayDto>(ChartDays);
        for (var i = ChartDays - 1; i >= 0; i--)
        {
            var day = today.AddDays(-i);
            days.Add(new InsightsDayDto(day, DoneOn(day)));
        }

        // Streak: consecutive days with at least one completion. A day with none yet
        // (today) doesn't break it — the streak then counts back from yesterday.
        var streak = 0;
        var cursor = byDay.ContainsKey(today) ? today : today.AddDays(-1);
        while (byDay.ContainsKey(cursor))
        {
            streak++;
            cursor = cursor.AddDays(-1);
        }

        var windowStart = today.AddDays(-(BreakdownWindowDays - 1));
        var categories = completed
            .Where(o =>
            {
                var day = DayMath.DayOf(o.StartAt!.Value, ctx);
                return day >= windowStart && day <= today;
            })
            .GroupBy(o => o.Activity.Category?.Id)
            .Select(g =>
            {
                var cat = g.First().Activity.Category;
                return new InsightsCategoryDto(cat?.Id, cat?.Name, cat?.Color, cat?.Icon, g.Count());
            })
            .OrderByDescending(c => c.Done)
            .ThenBy(c => c.Name)
            .ToList();

        return new InsightsDto(
            DoneToday: DoneOn(today),
            DoneThisWeek: DoneSince(today.AddDays(-6)),
            DoneLast30Days: DoneSince(windowStart),
            CurrentStreakDays: streak,
            Days: days,
            Categories: categories);
    }
}
