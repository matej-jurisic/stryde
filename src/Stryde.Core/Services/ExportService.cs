using Microsoft.EntityFrameworkCore;
using Stryde.Core.Common;
using Stryde.Core.Data;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;

namespace Stryde.Core.Services;

public class ExportService(StrydeDbContext db)
{
    public async Task<Result<ExportDto>> GetAsync(Guid userId)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user is null) return Result<ExportDto>.Fail(new Error(ErrorType.NotFound, "User not found."));

        var settings = await db.UserSettings.FirstOrDefaultAsync(s => s.UserId == userId)
            ?? new UserSettings { UserId = userId };

        var categories = await db.Categories.Where(c => c.UserId == userId).ToListAsync();
        var goals = await db.Goals.Include(g => g.Checkpoints).Where(g => g.UserId == userId).ToListAsync();
        var activities = await db.Activities
            .Include(a => a.Subtasks)
            .Include(a => a.Category)
            .Include(a => a.Goal)
            .Where(a => a.UserId == userId)
            .ToListAsync();
        var occurrences = await db.Occurrences
            .Include(o => o.Activity)
            .Include(o => o.Subtasks)
            .Where(o => o.UserId == userId)
            .ToListAsync();

        return Result<ExportDto>.Success(new ExportDto(
            DateTimeOffset.UtcNow,
            UserDto.FromEntity(user),
            UserSettingsDto.FromEntity(settings, user.Timezone),
            categories.OrderBy(c => c.CreatedAt).Select(CategoryDto.FromEntity).ToList(),
            goals.OrderBy(g => g.CreatedAt).Select(g => GoalDto.FromEntity(g)).ToList(),
            activities.OrderBy(a => a.CreatedAt).Select(ActivityDto.FromEntity).ToList(),
            occurrences.OrderBy(o => o.CreatedAt).Select(ExportOccurrenceDto.FromEntity).ToList()));
    }
}
