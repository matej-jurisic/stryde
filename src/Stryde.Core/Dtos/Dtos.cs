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
    DateTimeOffset CreatedAt,
    CategorySummaryDto? Category,
    GoalSummaryDto? Goal,
    List<ActivitySubtaskDto> Subtasks)
{
    public static ActivityDto FromEntity(Activity a) => new(
        a.Id, a.UserId, a.Title, a.CategoryId, a.GoalId, a.Kind.ToString(), a.CreatedAt,
        a.Category is not null ? CategorySummaryDto.FromEntity(a.Category) : null,
        a.Goal is not null ? GoalSummaryDto.FromEntity(a.Goal) : null,
        a.Subtasks.OrderBy(s => s.CreatedAt).Select(ActivitySubtaskDto.FromEntity).ToList());
}

public sealed record CreateActivityRequest(string Title, Guid? CategoryId, Guid? GoalId);
public sealed record UpdateActivityRequest(string Title, Guid? CategoryId, Guid? GoalId);

// Activity subtasks
public sealed record ActivitySubtaskDto(Guid Id, Guid ActivityId, string Title, DateTimeOffset CreatedAt)
{
    public static ActivitySubtaskDto FromEntity(ActivitySubtask s) => new(s.Id, s.ActivityId, s.Title, s.CreatedAt);
}

public sealed record CreateActivitySubtaskRequest(string Title);
public sealed record UpdateActivitySubtaskRequest(string Title);

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
    int? DurationMinutes);

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
    List<Guid> CompletedSubtaskIds,
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
        o.SubtaskCompletions.Select(c => c.SubtaskId).ToList(),
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

public sealed record UpdateOccurrenceRequest(
    string? Title,
    DateTimeOffset? StartAt,
    DateTimeOffset? EndAt,
    bool IsAllDay,
    bool IsPlanned,
    int? DurationMinutes);

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
    GoalOccurrenceStats? OccurrenceStats = null)
{
    public static GoalDto FromEntity(Goal g, GoalOccurrenceStats? stats = null) => new(
        g.Id, g.UserId, g.Title, g.Description, g.Notes,
        g.Status.ToString(), g.Kind.ToString(), g.CreatedAt,
        g.Checkpoints.Select(CheckpointDto.FromEntity).ToList(),
        stats);
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

// Recommendations — "activity" for all tiers; timing fields null when no history exists
public sealed record RecommendationDto(int Tier, string Type, OccurrenceDto? Occurrence, ActivityDto? Activity, int? TypicalDurationMinutes, string? TypicalStartTime);

// UserSettings
public sealed record UserSettingsDto(Guid UserId, int MaxFocusGoals, string DayBoundaryTime, string Timezone)
{
    public static UserSettingsDto FromEntity(UserSettings us, string timezone) => new(
        us.UserId, us.MaxFocusGoals, us.DayBoundaryTime.ToString("HH:mm"), timezone);
}

public sealed record UpdateUserSettingsRequest(int MaxFocusGoals, string DayBoundaryTime, string Timezone);
