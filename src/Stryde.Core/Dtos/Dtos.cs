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

public sealed record GoalSummaryDto(Guid Id, string Title, string Status)
{
    public static GoalSummaryDto FromEntity(Goal g) => new(g.Id, g.Title, g.Status.ToString());
}

// Activities
public sealed record ActivityDto(
    Guid Id,
    Guid UserId,
    string Title,
    Guid? CategoryId,
    Guid? GoalId,
    DateTimeOffset CreatedAt,
    CategorySummaryDto? Category,
    GoalSummaryDto? Goal)
{
    public static ActivityDto FromEntity(Activity a) => new(
        a.Id, a.UserId, a.Title, a.CategoryId, a.GoalId, a.CreatedAt,
        a.Category is not null ? CategorySummaryDto.FromEntity(a.Category) : null,
        a.Goal is not null ? GoalSummaryDto.FromEntity(a.Goal) : null);
}

public sealed record CreateActivityRequest(string Title, Guid? CategoryId, Guid? GoalId);
public sealed record UpdateActivityRequest(string Title, Guid? CategoryId, Guid? GoalId);

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
    Guid? RepeatRuleId,
    DateTimeOffset CreatedAt,
    bool IsOverdue,
    bool IsAllDay,
    DateTimeOffset? WindowStart,
    DateTimeOffset? WindowEnd,
    int? WindowDurationMinutes,
    ActivityDto Activity)
{
    public static OccurrenceDto FromEntity(Occurrence o, DayContext ctx, DateTimeOffset nowUtc) => new(
        o.Id, o.UserId, o.ActivityId, o.Title,
        o.Title ?? o.Activity.Title,
        o.StartAt, o.EndAt,
        o.Status.ToString(), o.RepeatRuleId, o.CreatedAt,
        DayMath.IsOverdue(o, ctx, nowUtc),
        o.IsAllDay,
        o.WindowStart, o.WindowEnd, o.WindowDurationMinutes,
        ActivityDto.FromEntity(o.Activity));
}

public sealed record CreateOccurrenceRequest(
    Guid ActivityId,
    string? Title,
    DateTimeOffset? StartAt,
    DateTimeOffset? EndAt,
    bool IsAllDay,
    DateTimeOffset? WindowStart,
    DateTimeOffset? WindowEnd,
    int? WindowDurationMinutes);

public sealed record UpdateOccurrenceRequest(
    string? Title,
    DateTimeOffset? StartAt,
    DateTimeOffset? EndAt,
    bool IsAllDay,
    DateTimeOffset? WindowStart,
    DateTimeOffset? WindowEnd,
    int? WindowDurationMinutes);

public sealed record SetOccurrenceStatusRequest(EventStatus Status);

// Goals
public sealed record GoalDto(
    Guid Id,
    Guid UserId,
    string Title,
    string? Description,
    string Status,
    Guid? CategoryId,
    DateTimeOffset CreatedAt,
    CategorySummaryDto? Category,
    List<CheckpointDto> Checkpoints)
{
    public static GoalDto FromEntity(Goal g) => new(
        g.Id, g.UserId, g.Title, g.Description,
        g.Status.ToString(), g.CategoryId, g.CreatedAt,
        g.Category is not null ? CategorySummaryDto.FromEntity(g.Category) : null,
        g.Checkpoints.Select(CheckpointDto.FromEntity).ToList());
}

public sealed record CreateGoalRequest(string Title, string? Description, Guid? CategoryId);
public sealed record UpdateGoalRequest(string Title, string? Description, Guid? CategoryId);
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

// Recommendations — "occurrence" for tiers 1/2/4, "activity" for tier 3 habit suggestions
public sealed record RecommendationDto(int Tier, string Type, OccurrenceDto? Occurrence, ActivityDto? Activity);

// UserSettings
public sealed record UserSettingsDto(Guid UserId, int MaxFocusGoals, string DayBoundaryTime, string Timezone)
{
    public static UserSettingsDto FromEntity(UserSettings us, string timezone) => new(
        us.UserId, us.MaxFocusGoals, us.DayBoundaryTime.ToString("HH:mm"), timezone);
}

public sealed record UpdateUserSettingsRequest(int MaxFocusGoals, string DayBoundaryTime, string Timezone);
