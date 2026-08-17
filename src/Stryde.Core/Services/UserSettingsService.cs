using Microsoft.EntityFrameworkCore;
using Stryde.Core.Common;
using Stryde.Core.Data;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;
using Stryde.Core.Llm;

namespace Stryde.Core.Services;

public class UserSettingsService(StrydeDbContext db)
{
    public async Task<UserSettings> GetOrCreateAsync(Guid userId)
    {
        var settings = await db.UserSettings
            .Include(s => s.UnaccountedRequirements)
            .FirstOrDefaultAsync(s => s.UserId == userId);
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

    /// <summary>
    /// The values that make time count towards the unaccounted-time stats, grouped the way a
    /// requirement is read: ORed within a state, ANDed across states. Empty when unconfigured, which
    /// is the case that has to stay free - the caller then skips the state machinery entirely.
    /// </summary>
    public async Task<List<(Guid StateId, HashSet<Guid> Allowed)>> GetUnaccountedMaskAsync(Guid userId) =>
        (await db.UnaccountedTimeRequirements
            .AsNoTracking()
            .Where(r => r.UserId == userId)
            .Select(r => new { r.StateValueId, r.StateValue.StateId })
            .ToListAsync())
        .GroupBy(r => r.StateId)
        .Select(g => (StateId: g.Key, Allowed: g.Select(r => r.StateValueId).ToHashSet()))
        .ToList();

    public async Task<Result<UserSettingsDto>> GetDtoAsync(Guid userId)
    {
        var settings = await db.UserSettings
            .Include(s => s.User)
            .Include(s => s.UnaccountedRequirements)
            .FirstOrDefaultAsync(s => s.UserId == userId);

        if (settings is not null)
            return Result<UserSettingsDto>.Success(UserSettingsDto.FromEntity(settings, settings.User.Timezone));

        // UserSettings not created yet — verify the user exists then create defaults
        var user = await db.Users.FindAsync(userId);
        if (user is null) return Result<UserSettingsDto>.Fail(new Error(ErrorType.NotFound, "User not found."));
        var created = await GetOrCreateAsync(userId);
        return Result<UserSettingsDto>.Success(UserSettingsDto.FromEntity(created, user.Timezone));
    }

    public async Task<Result<UserSettingsDto>> UpdateAsync(Guid userId, UpdateUserSettingsRequest req)
    {
        if (req.MaxFocusGoals < 1 || req.MaxFocusGoals > 20)
            return Result<UserSettingsDto>.Fail(new Error(ErrorType.Validation, "Max focus goals must be between 1 and 20."));

        if (req.MaxCalendarSuggestions < 1 || req.MaxCalendarSuggestions > 12)
            return Result<UserSettingsDto>.Fail(new Error(ErrorType.Validation, "Calendar suggestions must be between 1 and 12."));

        if (!TimeOnly.TryParseExact(req.DayBoundaryTime, ["HH:mm", "H:mm"], out var boundary))
            return Result<UserSettingsDto>.Fail(new Error(ErrorType.Validation, "Day boundary time must be in HH:mm format."));

        var err = Validators.ValidateTimezone(req.Timezone) ?? Validators.ValidateLlmBaseUrl(req.LlmBaseUrl);
        if (err is not null) return Result<UserSettingsDto>.Fail(err);

        if (req.LlmTimeoutSeconds is { } timeout && timeout is < 5 or > LlmOptions.MaxTimeoutSeconds)
            return Result<UserSettingsDto>.Fail(new Error(
                ErrorType.Validation, $"Timeout must be between 5 and {LlmOptions.MaxTimeoutSeconds} seconds."));

        var user = await db.Users.FindAsync(userId);
        if (user is null) return Result<UserSettingsDto>.Fail(new Error(ErrorType.NotFound, "User not found."));

        var settings = await GetOrCreateAsync(userId);
        settings.MaxFocusGoals = req.MaxFocusGoals;
        settings.DayBoundaryTime = boundary;
        settings.MaxCalendarSuggestions = req.MaxCalendarSuggestions;
        user.Timezone = req.Timezone;

        // Merged into locals first, so the cross-field check below judges the row as it will be
        // rather than whichever half of it this request happened to carry - and so a rejection
        // leaves nothing half-applied on the tracked entity.
        var llmEnabled = req.LlmEnabled ?? settings.LlmEnabled;
        var llmBaseUrl = req.LlmBaseUrl is null
            ? settings.LlmBaseUrl
            : string.IsNullOrWhiteSpace(req.LlmBaseUrl) ? null : req.LlmBaseUrl.Trim().TrimEnd('/');
        var llmModel = req.LlmModel is null
            ? settings.LlmModel
            : string.IsNullOrWhiteSpace(req.LlmModel) ? null : req.LlmModel.Trim();

        // Caught here rather than left to the first call: switching the assistant on with nothing to
        // call is a mistake made in this form, so it is answered in this form.
        if (llmEnabled && (string.IsNullOrWhiteSpace(llmBaseUrl) || string.IsNullOrWhiteSpace(llmModel)))
            return Result<UserSettingsDto>.Fail(new Error(
                ErrorType.Validation, "Set a server address and a model before turning the assistant on."));

        settings.LlmEnabled = llmEnabled;
        settings.LlmBaseUrl = llmBaseUrl;
        settings.LlmModel = llmModel;
        settings.LlmTimeoutSeconds = req.LlmTimeoutSeconds ?? settings.LlmTimeoutSeconds;
        settings.LlmNoThink = req.LlmNoThink ?? settings.LlmNoThink;

        var maskErr = await ApplyUnaccountedMaskAsync(settings, userId, req.UnaccountedStateValueIds);
        if (maskErr is not null) return Result<UserSettingsDto>.Fail(maskErr);

        await db.SaveChangesAsync();

        return Result<UserSettingsDto>.Success(UserSettingsDto.FromEntity(settings, user.Timezone));
    }

    /// <summary>
    /// Brings the unaccounted-time mask in line with the request. Null means "leave it alone", the
    /// same contract <c>ActivityService.ApplyStatesAsync</c> offers, and for the same reason: a client
    /// editing the day boundary should not have to know this field exists.
    /// <para>
    /// Diffed rather than cleared and rebuilt - the row keys on its own contents, so removing and
    /// re-adding an unchanged one would put a Deleted and an Added entity with the same key in the
    /// change tracker at once.
    /// </para>
    /// </summary>
    private async Task<Error?> ApplyUnaccountedMaskAsync(
        UserSettings settings, Guid userId, List<Guid>? valueIds)
    {
        if (valueIds is null) return null;

        var desired = valueIds.Distinct().ToHashSet();

        // Joined through State so one user cannot reference another's value by guessing an id.
        var owned = await db.StateValues
            .AsNoTracking()
            .Where(v => desired.Contains(v.Id) && v.State.UserId == userId)
            .Select(v => v.Id)
            .ToListAsync();

        if (owned.Count != desired.Count)
            return new Error(ErrorType.NotFound, "State value not found.");

        foreach (var existing in settings.UnaccountedRequirements.ToList())
        {
            if (desired.Contains(existing.StateValueId))
            {
                desired.Remove(existing.StateValueId);
            }
            else
            {
                settings.UnaccountedRequirements.Remove(existing);
                db.UnaccountedTimeRequirements.Remove(existing);
            }
        }

        // Explicit Add forces the Added state; the pre-set composite key would otherwise let change
        // detection treat it as an existing row. Fixup then also appends it to the collection the
        // response is built from, hence the guard.
        foreach (var valueId in desired)
        {
            var row = new UnaccountedTimeRequirement { UserId = userId, StateValueId = valueId };
            db.UnaccountedTimeRequirements.Add(row);
            if (!settings.UnaccountedRequirements.Contains(row)) settings.UnaccountedRequirements.Add(row);
        }

        return null;
    }
}
