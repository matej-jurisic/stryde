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

    /// <summary>Timezone + day boundary for all day-bucketing. Unknown timezone ids fall back to UTC.</summary>
    public async Task<DayContext> GetDayContextAsync(Guid userId)
    {
        // Single query: JOIN UserSettings → User via navigation property
        var row = await db.UserSettings
            .Where(s => s.UserId == userId)
            .Select(s => new { s.DayBoundaryTime, s.User.Timezone })
            .FirstOrDefaultAsync();

        if (row is null)
        {
            // UserSettings not created yet (first request before settings endpoint ran)
            var tz = await db.Users
                .Where(u => u.Id == userId)
                .Select(u => u.Timezone)
                .FirstOrDefaultAsync();
            return new DayContext(DayMath.ResolveTimeZone(tz), TimeOnly.MinValue);
        }

        return new DayContext(DayMath.ResolveTimeZone(row.Timezone), row.DayBoundaryTime);
    }

    public async Task<Result<UserSettingsDto>> GetDtoAsync(Guid userId)
    {
        // Single query: JOIN UserSettings → User via navigation property
        var row = await db.UserSettings
            .Where(s => s.UserId == userId)
            .Select(s => new { Settings = s, s.User.Timezone })
            .FirstOrDefaultAsync();

        if (row is not null)
            return Result<UserSettingsDto>.Success(UserSettingsDto.FromEntity(row.Settings, row.Timezone));

        // UserSettings not created yet — verify the user exists then create defaults
        var user = await db.Users.FindAsync(userId);
        if (user is null) return Result<UserSettingsDto>.Fail(new Error(ErrorType.NotFound, "User not found."));
        var settings = await GetOrCreateAsync(userId);
        return Result<UserSettingsDto>.Success(UserSettingsDto.FromEntity(settings, user.Timezone));
    }

    public async Task<Result<UserSettingsDto>> UpdateAsync(Guid userId, UpdateUserSettingsRequest req)
    {
        if (req.MaxFocusGoals < 1 || req.MaxFocusGoals > 20)
            return Result<UserSettingsDto>.Fail(new Error(ErrorType.Validation, "Max focus goals must be between 1 and 20."));

        if (!TimeOnly.TryParseExact(req.DayBoundaryTime, ["HH:mm", "H:mm"], out var boundary))
            return Result<UserSettingsDto>.Fail(new Error(ErrorType.Validation, "Day boundary time must be in HH:mm format."));

        var err = Validators.ValidateTimezone(req.Timezone);
        if (err is not null) return Result<UserSettingsDto>.Fail(err);

        var user = await db.Users.FindAsync(userId);
        if (user is null) return Result<UserSettingsDto>.Fail(new Error(ErrorType.NotFound, "User not found."));

        var settings = await GetOrCreateAsync(userId);
        settings.MaxFocusGoals = req.MaxFocusGoals;
        settings.DayBoundaryTime = boundary;
        user.Timezone = req.Timezone;
        await db.SaveChangesAsync();

        return Result<UserSettingsDto>.Success(UserSettingsDto.FromEntity(settings, user.Timezone));
    }
}
