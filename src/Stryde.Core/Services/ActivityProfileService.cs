using Microsoft.EntityFrameworkCore;
using Stryde.Core.Common;
using Stryde.Core.Data;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;
using Stryde.Core.Enums;

namespace Stryde.Core.Services;

/// <summary>
/// Resolves the scheduling profile the engine actually uses: <see cref="ActivityProfiles"/>
/// defaults with the user's <see cref="ActivityTypeSetting"/> overrides layered on top.
/// </summary>
public class ActivityProfileService(StrydeDbContext db)
{
    /// <summary>Eight hours. Past this a "minimum block" is a day, not a block.</summary>
    public const int MaxBlockMinutes = 480;

    /// <summary>Ceiling on suggestions of one type per day. 0 stays "unlimited".</summary>
    public const int MaxPerDayCeiling = 24;

    /// <summary>
    /// Every type's effective profile. All types are always present, so callers can index directly.
    /// </summary>
    public async Task<Dictionary<ActivityType, ActivityProfile>> ResolveAsync(Guid userId)
    {
        var overrides = await LoadOverridesAsync(userId);
        return ActivityProfiles.AllTypes.ToDictionary(
            t => t,
            t => Apply(ActivityProfiles.For(t), overrides.GetValueOrDefault(t)));
    }

    public async Task<List<ActivityProfileDto>> GetDtosAsync(Guid userId)
    {
        var overrides = await LoadOverridesAsync(userId);
        return ActivityProfiles.AllTypes
            .Select(t =>
            {
                var row = overrides.GetValueOrDefault(t);
                return ActivityProfileDto.From(t, Apply(ActivityProfiles.For(t), row), IsCustomised(row));
            })
            .ToList();
    }

    /// <summary>
    /// Stores only what differs from the built-in default, and drops the row entirely once nothing
    /// does. Retuning a default then still reaches every field the user left alone.
    /// </summary>
    public async Task<Result<List<ActivityProfileDto>>> UpdateAsync(
        Guid userId, ActivityType type, UpdateActivityProfileRequest req)
    {
        if (!TimeOnly.TryParseExact(req.WindowStart, ["HH:mm", "H:mm"], out var start))
            return Fail("Window start must be in HH:mm format.");
        if (!TimeOnly.TryParseExact(req.WindowEnd, ["HH:mm", "H:mm"], out var end))
            return Fail("Window end must be in HH:mm format.");

        // Placement walks a chronological list of candidate starts between the two, so a window that
        // wraps past midnight would simply never match anything.
        if (start >= end)
            return Fail("Window start must be before window end.");

        if (req.MinBlockMinutes < 0 || req.MinBlockMinutes > MaxBlockMinutes)
            return Fail($"Minimum block must be between 0 and {MaxBlockMinutes} minutes.");

        if (req.MaxPerDay < 0 || req.MaxPerDay > MaxPerDayCeiling)
            return Fail($"Max per day must be between 0 and {MaxPerDayCeiling}.");

        var user = await db.Users.FindAsync(userId);
        if (user is null)
            return Result<List<ActivityProfileDto>>.Fail(new Error(ErrorType.NotFound, "User not found."));

        var d = ActivityProfiles.For(type);
        var row = await db.ActivityTypeSettings.FirstOrDefaultAsync(s => s.UserId == userId && s.Type == type);

        var windowStart = start == d.WindowStart ? null : (TimeOnly?)start;
        var windowEnd = end == d.WindowEnd ? null : (TimeOnly?)end;
        var minBlock = req.MinBlockMinutes == d.MinBlockMinutes ? null : (int?)req.MinBlockMinutes;
        var maxPerDay = req.MaxPerDay == d.MaxPerDay ? null : (int?)req.MaxPerDay;
        var isDefault = windowStart is null && windowEnd is null && minBlock is null && maxPerDay is null;

        if (isDefault)
        {
            if (row is not null) db.ActivityTypeSettings.Remove(row);
        }
        else
        {
            if (row is null)
            {
                row = new ActivityTypeSetting { UserId = userId, Type = type };
                db.ActivityTypeSettings.Add(row);
            }
            row.WindowStart = windowStart;
            row.WindowEnd = windowEnd;
            row.MinBlockMinutes = minBlock;
            row.MaxPerDay = maxPerDay;
        }

        await db.SaveChangesAsync();
        return Result<List<ActivityProfileDto>>.Success(await GetDtosAsync(userId));
    }

    /// <summary>Drops one type back to its built-in profile. A no-op when it was never overridden.</summary>
    public async Task<Result<List<ActivityProfileDto>>> ResetAsync(Guid userId, ActivityType type)
    {
        var row = await db.ActivityTypeSettings.FirstOrDefaultAsync(s => s.UserId == userId && s.Type == type);
        if (row is not null)
        {
            db.ActivityTypeSettings.Remove(row);
            await db.SaveChangesAsync();
        }
        return Result<List<ActivityProfileDto>>.Success(await GetDtosAsync(userId));
    }

    private async Task<Dictionary<ActivityType, ActivityTypeSetting>> LoadOverridesAsync(Guid userId) =>
        await db.ActivityTypeSettings
            .AsNoTracking()
            .Where(s => s.UserId == userId)
            .ToDictionaryAsync(s => s.Type);

    private static ActivityProfile Apply(ActivityProfile p, ActivityTypeSetting? o) =>
        o is null
            ? p
            : p with
            {
                WindowStart = o.WindowStart ?? p.WindowStart,
                WindowEnd = o.WindowEnd ?? p.WindowEnd,
                MinBlockMinutes = o.MinBlockMinutes ?? p.MinBlockMinutes,
                MaxPerDay = o.MaxPerDay ?? p.MaxPerDay,
            };

    private static bool IsCustomised(ActivityTypeSetting? o) =>
        o is not null && (o.WindowStart is not null || o.WindowEnd is not null
            || o.MinBlockMinutes is not null || o.MaxPerDay is not null);

    private static Result<List<ActivityProfileDto>> Fail(string message) =>
        Result<List<ActivityProfileDto>>.Fail(new Error(ErrorType.Validation, message));
}
