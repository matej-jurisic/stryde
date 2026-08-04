using Microsoft.EntityFrameworkCore;
using Stryde.Core.Common;
using Stryde.Core.Data;
using Stryde.Core.Dtos;
using Stryde.Core.Enums;

namespace Stryde.Core.Services;

/// <summary>
/// Read-only totals over completed occurrences.
/// <para>
/// Everything here is a sum over what the user chose to log. There is deliberately no stat whose
/// denominator is the length of a day: the calendar is not assumed to be complete, so "unaccounted
/// time" is not a measurable quantity and an empty hour means nothing in particular.
/// </para>
/// </summary>
public class InsightsService(StrydeDbContext db, UserSettingsService settings)
{
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

        // Only occurrences with both timestamps and positive elapsed time contribute: a duration has
        // to have actually been measured for a total to mean anything.
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

        return new InsightsDto(activities, categories);
    }
}
