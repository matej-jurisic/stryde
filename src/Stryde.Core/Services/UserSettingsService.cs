using Microsoft.EntityFrameworkCore;
using Stryde.Core.Common;
using Stryde.Core.Data;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;

namespace Stryde.Core.Services;

public class UserSettingsService(StrydeDbContext db)
{
    public async Task<UserSettings> GetOrCreateAsync(Guid userId)
    {
        var settings = await db.UserSettings.FindAsync(userId);
        if (settings is not null) return settings;

        settings = new UserSettings { UserId = userId };
        db.UserSettings.Add(settings);
        await db.SaveChangesAsync();
        return settings;
    }

    public async Task<Result<UserSettingsDto>> UpdateAsync(Guid userId, UpdateUserSettingsRequest req)
    {
        if (req.MaxFocusGoals < 1 || req.MaxFocusGoals > 20)
            return Result<UserSettingsDto>.Fail(new Error(ErrorType.Validation, "Max focus goals must be between 1 and 20."));

        if (!TimeOnly.TryParseExact(req.DayBoundaryTime, ["HH:mm", "H:mm"], out var boundary))
            return Result<UserSettingsDto>.Fail(new Error(ErrorType.Validation, "Day boundary time must be in HH:mm format."));

        var settings = await GetOrCreateAsync(userId);
        settings.MaxFocusGoals = req.MaxFocusGoals;
        settings.DayBoundaryTime = boundary;
        await db.SaveChangesAsync();

        return Result<UserSettingsDto>.Success(UserSettingsDto.FromEntity(settings));
    }
}
