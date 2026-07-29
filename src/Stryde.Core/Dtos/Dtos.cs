using Stryde.Core.Common;
using Stryde.Core.Entities;
using Stryde.Core.Enums;

namespace Stryde.Core.Dtos;

// Auth
public sealed record UserDto(Guid Id, string Username, string Timezone)
{
    public static UserDto FromEntity(User u) => new(u.Id, u.Username, u.Timezone);
}

public sealed record AuthResult(string AccessToken, UserDto User, string RefreshToken, DateTimeOffset RefreshTokenExpiry);

public sealed record RegisterRequest(string Username, string Password, string Timezone);
public sealed record LoginRequest(string Username, string Password);

// Shared summaries
public sealed record CategorySummaryDto(Guid Id, string Name, string Color, string? Icon)
{
    public static CategorySummaryDto FromEntity(Entities.Category c) => new(c.Id, c.Name, c.Color, c.Icon);
}

public sealed record GoalSummaryDto(Guid Id, string Title, string Status, string Kind)
{
    public static GoalSummaryDto FromEntity(Goal g) => new(g.Id, g.Title, g.Status.ToString(), g.Kind.ToString());
}

// Activities
public sealed record ActivityDto(
    Guid Id,
    Guid UserId,
    string Title,
    Guid? CategoryId,
    Guid? GoalId,
    string Kind,
    string Type,
    bool ExcludeFromRecommendations,
    DateTimeOffset CreatedAt,
    CategorySummaryDto? Category,
    GoalSummaryDto? Goal,
    List<ActivitySubtaskDto> Subtasks,
    List<Guid> SetsStateValueIds,
    List<Guid> RequiredStateValueIds)
{
    public static ActivityDto FromEntity(Activity a) => new(
        a.Id, a.UserId, a.Title, a.CategoryId, a.GoalId, a.Kind.ToString(), a.Type.ToString(), a.ExcludeFromRecommendations, a.CreatedAt,
        a.Category is not null ? CategorySummaryDto.FromEntity(a.Category) : null,
        a.Goal is not null ? GoalSummaryDto.FromEntity(a.Goal) : null,
        a.Subtasks.OrderBy(s => s.CreatedAt).Select(ActivitySubtaskDto.FromEntity).ToList(),
        a.StateEffects.Select(e => e.StateValueId).ToList(),
        a.StateRequirements.Select(r => r.StateValueId).ToList());
}

// Bare value ids rather than nested value objects: the client already holds the whole state list from
// `GET /api/states` and resolves names from it, and a flat list is what both write paths send back.
public sealed record CreateActivityRequest(
    string Title, Guid? CategoryId, Guid? GoalId, ActivityType Type = ActivityType.general,
    List<Guid>? SetsStateValueIds = null, List<Guid>? RequiredStateValueIds = null);
public sealed record UpdateActivityRequest(
    string Title, Guid? CategoryId, Guid? GoalId, bool ExcludeFromRecommendations = false,
    ActivityType Type = ActivityType.general,
    List<Guid>? SetsStateValueIds = null, List<Guid>? RequiredStateValueIds = null);
public sealed record SetActivityRecommendationsRequest(bool ExcludeFromRecommendations);

// Activity subtasks (template)
public sealed record ActivitySubtaskDto(Guid Id, Guid ActivityId, string Title, DateTimeOffset CreatedAt)
{
    public static ActivitySubtaskDto FromEntity(ActivitySubtask s) => new(s.Id, s.ActivityId, s.Title, s.CreatedAt);
}

public sealed record CreateActivitySubtaskRequest(string Title);
public sealed record UpdateActivitySubtaskRequest(string Title);

// Occurrence subtasks (per-occurrence copy)
public sealed record OccurrenceSubtaskDto(Guid Id, Guid OccurrenceId, string Title, bool IsDone, DateTimeOffset CreatedAt)
{
    public static OccurrenceSubtaskDto FromEntity(OccurrenceSubtask s) => new(s.Id, s.OccurrenceId, s.Title, s.IsDone, s.CreatedAt);
}

public sealed record CreateOccurrenceSubtaskRequest(string Title);
public sealed record UpdateOccurrenceSubtaskRequest(string Title);

// Full-set subtask input for occurrence updates: Id set = keep existing (IsDone preserved),
// Id null = create new. Existing subtasks missing from the list are deleted. Null list = leave untouched.
public sealed record OccurrenceSubtaskInput(Guid? Id, string Title);

public sealed record CreateEventRequest(
    string Title,
    Guid? CategoryId,
    Guid? GoalId,
    DateTimeOffset? StartAt,
    DateTimeOffset? EndAt,
    bool IsAllDay,
    bool IsPlanned,
    int? DurationMinutes);

public sealed record UpdateEventRequest(
    string Title,
    Guid? CategoryId,
    Guid? GoalId,
    DateTimeOffset? StartAt,
    DateTimeOffset? EndAt,
    bool IsAllDay,
    bool IsPlanned,
    int? DurationMinutes,
    List<OccurrenceSubtaskInput>? Subtasks = null);

// Occurrences
public sealed record OccurrenceDto(
    Guid Id,
    Guid UserId,
    Guid ActivityId,
    string? Title,
    string EffectiveTitle,
    DateTimeOffset? StartAt,
    DateTimeOffset? EndAt,
    string Status,
    DateTimeOffset CreatedAt,
    bool IsOverdue,
    bool IsAllDay,
    bool IsPlanned,
    int? DurationMinutes,
    DateTimeOffset? WindowStart,
    DateTimeOffset? WindowEnd,
    int? WindowDurationMinutes,
    List<OccurrenceSubtaskDto> Subtasks,
    ActivityDto Activity)
{
    public static OccurrenceDto FromEntity(Occurrence o, DayContext ctx, DateTimeOffset nowUtc) => new(
        o.Id, o.UserId, o.ActivityId, o.Title,
        o.Title ?? o.Activity.Title,
        o.StartAt, o.EndAt,
        o.Status.ToString(), o.CreatedAt,
        DayMath.IsOverdue(o, ctx, nowUtc),
        o.IsAllDay,
        o.IsPlanned, o.DurationMinutes,
        o.WindowStart, o.WindowEnd, o.WindowDurationMinutes,
        o.Subtasks.OrderBy(s => s.CreatedAt).Select(OccurrenceSubtaskDto.FromEntity).ToList(),
        ActivityDto.FromEntity(o.Activity));
}

public sealed record CreateOccurrenceRequest(
    Guid ActivityId,
    string? Title,
    DateTimeOffset? StartAt,
    DateTimeOffset? EndAt,
    bool IsAllDay,
    bool IsPlanned,
    int? DurationMinutes,
    DateTimeOffset? WindowStart,
    DateTimeOffset? WindowEnd,
    int? WindowDurationMinutes);

/// <param name="ActivityId">
/// Re-points the occurrence at a different activity. Null leaves it where it is, so a caller that
/// does not care about the link can omit the field entirely. Only valid between activity-kind
/// activities: an event's activity is a backing row owned 1:1 by the occurrence, not a choice.
/// </param>
public sealed record UpdateOccurrenceRequest(
    string? Title,
    DateTimeOffset? StartAt,
    DateTimeOffset? EndAt,
    bool IsAllDay,
    bool IsPlanned,
    int? DurationMinutes,
    List<OccurrenceSubtaskInput>? Subtasks = null,
    Guid? ActivityId = null);

public sealed record SetOccurrenceStatusRequest(EventStatus Status);

// Goals
public sealed record GoalOccurrenceStats(int Done, int Skipped, int Pending);

public sealed record GoalDto(
    Guid Id,
    Guid UserId,
    string Title,
    string? Description,
    string? Notes,
    string Status,
    string Kind,
    DateTimeOffset CreatedAt,
    List<CheckpointDto> Checkpoints,
    GoalOccurrenceStats? OccurrenceStats = null,
    DateTimeOffset? LastOccurrenceAt = null)
{
    public static GoalDto FromEntity(Goal g, GoalOccurrenceStats? stats = null, DateTimeOffset? lastOccurrenceAt = null) => new(
        g.Id, g.UserId, g.Title, g.Description, g.Notes,
        g.Status.ToString(), g.Kind.ToString(), g.CreatedAt,
        g.Checkpoints.Select(CheckpointDto.FromEntity).ToList(),
        stats, lastOccurrenceAt);
}

public sealed record CreateGoalRequest(string Title, string? Description, GoalKind Kind = GoalKind.milestone, string? Notes = null);
public sealed record UpdateGoalRequest(string Title, string? Description, GoalKind Kind = GoalKind.milestone, string? Notes = null);
public sealed record SetGoalStatusRequest(GoalStatus Status);

// Checkpoints
public sealed record CheckpointDto(
    Guid Id,
    Guid GoalId,
    string Title,
    string Size,
    DateTimeOffset? TargetDate,
    string Status,
    DateTimeOffset CreatedAt)
{
    public static CheckpointDto FromEntity(Checkpoint c) => new(
        c.Id, c.GoalId, c.Title, c.Size.ToString(),
        c.TargetDate, c.Status.ToString(), c.CreatedAt);
}

public sealed record CreateCheckpointRequest(string Title, CheckpointSize Size, DateTimeOffset? TargetDate);
public sealed record UpdateCheckpointRequest(string Title, CheckpointSize Size, DateTimeOffset? TargetDate);
public sealed record SetCheckpointStatusRequest(CheckpointStatus Status);

// Categories
public sealed record CategoryDto(Guid Id, Guid UserId, string Name, string Color, string? Icon, DateTimeOffset CreatedAt)
{
    public static CategoryDto FromEntity(Entities.Category c) => new(c.Id, c.UserId, c.Name, c.Color, c.Icon, c.CreatedAt);
}

public sealed record CreateCategoryRequest(string Name, string Color, string? Icon);
public sealed record UpdateCategoryRequest(string Name, string Color, string? Icon);

// States — user-defined context the engine gates suggestions on. Values come nested, in creation
// order, because a state is meaningless without them and the client always needs both.
public sealed record StateDto(
    Guid Id, Guid UserId, string Name, DateTimeOffset CreatedAt, List<StateValueDto> Values)
{
    public static StateDto FromEntity(Entities.State s) => new(
        s.Id, s.UserId, s.Name, s.CreatedAt,
        s.Values.OrderBy(v => v.CreatedAt).Select(StateValueDto.FromEntity).ToList());
}

public sealed record StateValueDto(
    Guid Id, Guid StateId, string Name, bool IsDefault, int? DurationMinutes, DateTimeOffset CreatedAt)
{
    public static StateValueDto FromEntity(StateValue v) =>
        new(v.Id, v.StateId, v.Name, v.IsDefault, v.DurationMinutes, v.CreatedAt);
}

public sealed record CreateStateRequest(string Name);
public sealed record UpdateStateRequest(string Name);
public sealed record CreateStateValueRequest(string Name, bool IsDefault = false, int? DurationMinutes = null);
public sealed record UpdateStateValueRequest(string Name, bool IsDefault = false, int? DurationMinutes = null);

// Recommendations — always an activity to schedule; timing fields null when no history exists.
// DaysSinceLast/MedianGapDays/PatternCount are the raw "why" signals; the client composes the
// user-facing reason text from them. SuggestedStartAt is the best free slot on the target day,
// null when nothing fits, when the day is in the past (slots are not computed), or when the
// activity's habitual time is taken and every opening is too far from it.
public sealed record RecommendationDto(
    int Tier,
    ActivityDto Activity,
    int? TypicalDurationMinutes,
    string? TypicalStartTime,
    int? DaysSinceLast,
    double? MedianGapDays,
    int? PatternCount,
    DateTimeOffset? SuggestedStartAt);

// Insights — server-side day bucketing; floating occurrences (no StartAt) are excluded.
// Time = EndAt-StartAt when both set, else DurationMinutes, else 0.
public sealed record InsightsActivityDto(Guid ActivityId, string Title, string? CategoryColor, int TimeMinutes, int Count);

public sealed record InsightsCategoryDto(Guid? CategoryId, string? Name, string? Color, string? Icon, int Done, int TimeMinutes);

// A contiguous stretch of a tracked day with nothing logged. Start/End are local clock times ("HH:mm").
public sealed record InsightsGapDto(string Day, string Start, string End, int Minutes);

// A run of hour slots that is empty on most tracked days. EmptyDays uses the run's weakest slot.
public sealed record InsightsUnusedBlockDto(string Start, string End, int EmptyDays, int Days);

// Calendar overlay: minutes from local midnight; weekday 0 = Sunday (matches both .NET DayOfWeek and JS getDay).
public sealed record InsightsFreeRangeDto(int Weekday, int StartMinute, int EndMinute);

public sealed record InsightsEmptyProfileDto(List<InsightsFreeRangeDto> Ranges);

public sealed record InsightsDto(
    List<InsightsActivityDto> Activities,
    List<InsightsCategoryDto> Categories,
    int? AvgUnaccountedMinutesPerDay,
    int? PrevAvgUnaccountedMinutesPerDay,
    List<InsightsGapDto> LargestGaps,
    List<InsightsUnusedBlockDto> UnusedBlocks);

// Export — flat JSON snapshot of all user data, meant for external analysis.
// Not a backup format: there is no import path and the shape may change freely.
public sealed record ExportOccurrenceDto(
    Guid Id,
    Guid ActivityId,
    string Title,
    string Status,
    DateTimeOffset? StartAt,
    DateTimeOffset? EndAt,
    bool IsAllDay,
    bool IsPlanned,
    int? DurationMinutes,
    DateTimeOffset? WindowStart,
    DateTimeOffset? WindowEnd,
    int? WindowDurationMinutes,
    DateTimeOffset CreatedAt,
    List<OccurrenceSubtaskDto> Subtasks)
{
    public static ExportOccurrenceDto FromEntity(Occurrence o) => new(
        o.Id, o.ActivityId, o.Title ?? o.Activity.Title, o.Status.ToString(),
        o.StartAt, o.EndAt, o.IsAllDay, o.IsPlanned, o.DurationMinutes,
        o.WindowStart, o.WindowEnd, o.WindowDurationMinutes, o.CreatedAt,
        o.Subtasks.OrderBy(s => s.CreatedAt).Select(OccurrenceSubtaskDto.FromEntity).ToList());
}

public sealed record ExportDto(
    DateTimeOffset ExportedAt,
    UserDto User,
    UserSettingsDto Settings,
    List<ActivityProfileDto> ActivityProfiles,
    List<CategoryDto> Categories,
    List<GoalDto> Goals,
    List<ActivityDto> Activities,
    List<ExportOccurrenceDto> Occurrences);

// UserSettings
public sealed record UserSettingsDto(
    Guid UserId, int MaxFocusGoals, string DayBoundaryTime, string Timezone, int MaxCalendarSuggestions)
{
    public static UserSettingsDto FromEntity(UserSettings us, string timezone) => new(
        us.UserId, us.MaxFocusGoals, us.DayBoundaryTime.ToString("HH:mm"), timezone, us.MaxCalendarSuggestions);
}

public sealed record UpdateUserSettingsRequest(
    int MaxFocusGoals, string DayBoundaryTime, string Timezone, int MaxCalendarSuggestions);

// Activity type profiles
/// <summary>
/// One type's *resolved* profile: built-in defaults with the user's overrides applied.
/// <para>
/// The first four fields are editable. <paramref name="CadencePriorDays"/> and
/// <paramref name="MinDueFraction"/> are read-only, carried so the client can describe what the type
/// actually does without hardcoding values that would drift out of date.
/// <paramref name="IsCustomised"/> says whether any field differs from the built-in default, which is
/// what a Reset control keys off.
/// </para>
/// </summary>
public sealed record ActivityProfileDto(
    string Type,
    string WindowStart,
    string WindowEnd,
    int MinBlockMinutes,
    int MaxPerDay,
    double CadencePriorDays,
    double MinDueFraction,
    bool IsCustomised)
{
    public static ActivityProfileDto From(ActivityType type, ActivityProfile p, bool isCustomised) => new(
        type.ToString(),
        p.WindowStart.ToString("HH:mm"),
        p.WindowEnd.ToString("HH:mm"),
        p.MinBlockMinutes,
        p.MaxPerDay,
        p.CadencePriorDays,
        p.MinDueFraction,
        isCustomised);
}

public sealed record UpdateActivityProfileRequest(
    string WindowStart, string WindowEnd, int MinBlockMinutes, int MaxPerDay);
