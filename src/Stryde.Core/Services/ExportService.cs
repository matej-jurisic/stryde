using Microsoft.EntityFrameworkCore;
using Stryde.Core.Common;
using Stryde.Core.Data;
using Stryde.Core.Entities;

namespace Stryde.Core.Services;

/// <summary>
/// Loads the whole account and hands it to <see cref="ExportMarkdown"/>. The export is a document to
/// read, not a data format: there is no import path, so nothing here needs to round-trip.
/// </summary>
public class ExportService(StrydeDbContext db)
{
    public async Task<Result<string>> GetMarkdownAsync(Guid userId)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user is null) return Result<string>.Fail(new Error(ErrorType.NotFound, "User not found."));

        var settings = await db.UserSettings
                .Include(s => s.UnaccountedRequirements)
                .FirstOrDefaultAsync(s => s.UserId == userId)
            ?? new UserSettings { UserId = userId };

        var types = await db.ActivityTypes.Where(t => t.UserId == userId).ToListAsync();
        var categories = await db.Categories.Where(c => c.UserId == userId).ToListAsync();
        var goals = await db.Goals.Include(g => g.Checkpoints).Where(g => g.UserId == userId).ToListAsync();
        var states = await db.States.Include(s => s.Values).Where(s => s.UserId == userId).ToListAsync();
        var activities = await db.Activities
            .Include(a => a.Subtasks)
            .Include(a => a.Category)
            .Include(a => a.Goal)
            .Include(a => a.Type)
            .Include(a => a.StateEffects)
            .Include(a => a.StateRequirements)
            .Where(a => a.UserId == userId)
            .ToListAsync();
        var occurrences = await db.Occurrences
            .Include(o => o.Activity).ThenInclude(a => a.Category)
            .Include(o => o.Activity).ThenInclude(a => a.Goal)
            .Include(o => o.Subtasks)
            .Where(o => o.UserId == userId)
            .ToListAsync();

        var ctx = new DayContext(DayMath.ResolveTimeZone(user.Timezone), settings.DayBoundaryTime);
        var doc = new ExportMarkdown(
            ctx, user, settings, types, categories, goals, states, activities, occurrences,
            DateTimeOffset.UtcNow);

        return Result<string>.Success(doc.Render());
    }
}
