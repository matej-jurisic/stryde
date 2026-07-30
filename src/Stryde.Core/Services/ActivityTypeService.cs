using Microsoft.EntityFrameworkCore;
using Stryde.Core.Common;
using Stryde.Core.Data;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;

namespace Stryde.Core.Services;

/// <summary>
/// CRUD for a user's <see cref="ActivityType"/>s, plus the resolved profile map the recommendation
/// engine reads.
/// <para>
/// There is nothing to reconcile here: a type is a row the user owns, so what it says is what the
/// engine uses. Activities with no type are absent from the map entirely and fall to
/// <see cref="ActivityProfiles.Unconstrained"/>.
/// </para>
/// </summary>
public class ActivityTypeService(StrydeDbContext db)
{
    /// <summary>Eight hours. Past this a "minimum block" is a day, not a block.</summary>
    public const int MaxBlockMinutes = 480;

    /// <summary>Ceiling on suggestions of one type per day. 0 stays "unlimited".</summary>
    public const int MaxPerDayCeiling = 24;

    /// <summary>Longest cadence prior the UI can express, in days.</summary>
    public const double MaxCadencePriorDays = 365;

    /// <summary>
    /// Every type the user owns, keyed by id. The engine looks up by
    /// <see cref="Activity.ActivityTypeId"/>, so a missing key - no type, or an id pointing at a
    /// deleted row - is the unconstrained case and needs no entry.
    /// </summary>
    public async Task<Dictionary<Guid, ActivityProfile>> ResolveAsync(Guid userId) =>
        await db.ActivityTypes
            .AsNoTracking()
            .Where(t => t.UserId == userId)
            .ToDictionaryAsync(t => t.Id, t => ActivityProfiles.Of(t));

    public async Task<List<ActivityTypeDto>> ListAsync(Guid userId)
    {
        var types = await db.ActivityTypes.AsNoTracking().Where(t => t.UserId == userId).ToListAsync();

        // SQLite cannot ORDER BY a DateTimeOffset.
        return types.OrderBy(t => t.CreatedAt).Select(ActivityTypeDto.FromEntity).ToList();
    }

    public async Task<Result<ActivityTypeDto>> CreateAsync(Guid userId, CreateActivityTypeRequest req)
    {
        var parsed = Parse(req.Name, req.WindowStart, req.WindowEnd, req.MinBlockMinutes,
            req.MaxPerDay, req.CadencePriorDays, req.MinDueFraction);
        if (!parsed.IsSuccess) return Result<ActivityTypeDto>.Fail(parsed.Error!);

        var user = await db.Users.FindAsync(userId);
        if (user is null)
            return Result<ActivityTypeDto>.Fail(new Error(ErrorType.NotFound, "User not found."));

        var (start, end) = parsed.Value;
        var type = new ActivityType
        {
            UserId = userId,
            Name = req.Name.Trim(),
            Icon = Blank(req.Icon),
            WindowStart = start,
            WindowEnd = end,
            MinBlockMinutes = req.MinBlockMinutes,
            MaxPerDay = req.MaxPerDay,
            CadencePriorDays = req.CadencePriorDays,
            MinDueFraction = req.MinDueFraction,
        };

        db.ActivityTypes.Add(type);
        await db.SaveChangesAsync();
        return Result<ActivityTypeDto>.Success(ActivityTypeDto.FromEntity(type));
    }

    public async Task<Result<ActivityTypeDto>> UpdateAsync(
        Guid id, Guid userId, UpdateActivityTypeRequest req)
    {
        var parsed = Parse(req.Name, req.WindowStart, req.WindowEnd, req.MinBlockMinutes,
            req.MaxPerDay, req.CadencePriorDays, req.MinDueFraction);
        if (!parsed.IsSuccess) return Result<ActivityTypeDto>.Fail(parsed.Error!);

        var type = await db.ActivityTypes.FirstOrDefaultAsync(t => t.Id == id && t.UserId == userId);
        if (type is null) return NotFound();

        var (start, end) = parsed.Value;
        type.Name = req.Name.Trim();
        type.Icon = Blank(req.Icon);
        type.WindowStart = start;
        type.WindowEnd = end;
        type.MinBlockMinutes = req.MinBlockMinutes;
        type.MaxPerDay = req.MaxPerDay;
        type.CadencePriorDays = req.CadencePriorDays;
        type.MinDueFraction = req.MinDueFraction;

        await db.SaveChangesAsync();
        return Result<ActivityTypeDto>.Success(ActivityTypeDto.FromEntity(type));
    }

    /// <summary>
    /// Allowed unconditionally. Activities using the type are set-nulled by the FK and carry on
    /// unconstrained, exactly as they do when their category is deleted.
    /// </summary>
    public async Task<Result> DeleteAsync(Guid id, Guid userId)
    {
        var type = await db.ActivityTypes.FirstOrDefaultAsync(t => t.Id == id && t.UserId == userId);
        if (type is null) return Result.Fail(new Error(ErrorType.NotFound, "Activity type not found."));

        db.ActivityTypes.Remove(type);
        await db.SaveChangesAsync();
        return Result.Success();
    }

    /// <summary>
    /// The starting set every new user gets. These are ordinary rows with nothing privileged about
    /// them: each is reachable by hand from an empty form, which is the point of the whole design.
    /// Called from registration, and from the migration that introduced types for existing users.
    /// </summary>
    public async Task SeedDefaultsAsync(Guid userId)
    {
        db.ActivityTypes.AddRange(DefaultsFor(userId));
        await db.SaveChangesAsync();
    }

    /// <summary>
    /// Shared with the seeding migration so the two cannot drift. Cadence values are restricted to
    /// the set the editor's dropdown can round-trip - a seeded number the UI cannot reproduce would
    /// make a built-in type quietly better than a user-made one.
    /// </summary>
    public static List<ActivityType> DefaultsFor(Guid userId) =>
    [
        new()
        {
            UserId = userId,
            Name = "General",
            Icon = "Circle",
            WindowStart = new(8, 0),
            WindowEnd = new(21, 0),
            MinBlockMinutes = 0,
            MaxPerDay = 0,
            CadencePriorDays = ActivityProfiles.DefaultCadenceDays,
            MinDueFraction = 0,
        },
        // The 45 minute floor keeps a session out of the cracks a no-history activity would otherwise
        // be sized into at the 30-minute default, and the window clears a working day. The cooldown is
        // what produces rest days and alternation; the per-day cap is 2 rather than 1 so a run and a
        // lift can still share a day once each is past its own cooldown.
        new()
        {
            UserId = userId,
            Name = "Training",
            Icon = "Dumbbell",
            WindowStart = new(15, 0),
            WindowEnd = new(21, 0),
            MinBlockMinutes = 45,
            MaxPerDay = 2,
            CadencePriorDays = 2.5,
            MinDueFraction = 0.5,
        },
        // The highest block floor: a 30-minute crack is not deep work, and without this it would be
        // offered one. Cadence is 2.5 rather than the 3.0 this type carried while it was hardcoded,
        // because 3.0 is not a value the editor can express.
        new()
        {
            UserId = userId,
            Name = "Deep work",
            Icon = "Brain",
            WindowStart = new(9, 0),
            WindowEnd = new(17, 0),
            MinBlockMinutes = 90,
            MaxPerDay = 2,
            CadencePriorDays = 2.5,
            MinDueFraction = 0,
        },
    ];

    private static Result<(TimeOnly Start, TimeOnly End)> Parse(
        string? name, string windowStart, string windowEnd,
        int minBlockMinutes, int maxPerDay, double cadencePriorDays, double minDueFraction)
    {
        var err = Validators.ValidateTitle(name, "Name");
        if (err is not null) return Result<(TimeOnly, TimeOnly)>.Fail(err);

        if (!TimeOnly.TryParseExact(windowStart, ["HH:mm", "H:mm"], out var start))
            return Fail("Window start must be in HH:mm format.");
        if (!TimeOnly.TryParseExact(windowEnd, ["HH:mm", "H:mm"], out var end))
            return Fail("Window end must be in HH:mm format.");

        // Placement walks a chronological list of candidate starts between the two, so a window that
        // wraps past midnight would simply never match anything.
        if (start >= end)
            return Fail("Window start must be before window end.");

        if (minBlockMinutes < 0 || minBlockMinutes > MaxBlockMinutes)
            return Fail($"Minimum block must be between 0 and {MaxBlockMinutes} minutes.");

        if (maxPerDay < 0 || maxPerDay > MaxPerDayCeiling)
            return Fail($"Max per day must be between 0 and {MaxPerDayCeiling}.");

        // Zero would make everything permanently due, which is not a cadence.
        if (cadencePriorDays <= 0 || cadencePriorDays > MaxCadencePriorDays)
            return Fail($"Cadence must be between 0 and {MaxCadencePriorDays} days.");

        // A fraction of the activity's own gap between completions; past 1 it would suppress the
        // activity beyond its own rhythm forever.
        if (minDueFraction < 0 || minDueFraction > 1)
            return Fail("Cooldown must be between 0 and 1.");

        return Result<(TimeOnly, TimeOnly)>.Success((start, end));
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static Result<(TimeOnly, TimeOnly)> Fail(string message) =>
        Result<(TimeOnly, TimeOnly)>.Fail(new Error(ErrorType.Validation, message));

    private static Result<ActivityTypeDto> NotFound() =>
        Result<ActivityTypeDto>.Fail(new Error(ErrorType.NotFound, "Activity type not found."));
}
