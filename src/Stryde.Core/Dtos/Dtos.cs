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

// Events
public sealed record EventDto(
    Guid Id,
    Guid UserId,
    string Title,
    DateTimeOffset? StartAt,
    DateTimeOffset? EndAt,
    string Status,
    Guid? RepeatRuleId,
    DateTimeOffset CreatedAt,
    bool IsOverdue,
    List<GoalSummaryDto> Goals)
{
    public static EventDto FromEntity(Event e, Common.DayContext ctx, DateTimeOffset nowUtc) => new(
        e.Id, e.UserId, e.Title, e.StartAt, e.EndAt,
        e.Status.ToString(), e.RepeatRuleId, e.CreatedAt,
        Common.DayMath.IsOverdue(e, ctx, nowUtc),
        e.Goals.Select(GoalSummaryDto.FromEntity).ToList());
}

public sealed record GoalSummaryDto(Guid Id, string Title, string Status)
{
    public static GoalSummaryDto FromEntity(Goal g) => new(g.Id, g.Title, g.Status.ToString());
}

public sealed record CreateEventRequest(
    string Title,
    DateTimeOffset? StartAt,
    DateTimeOffset? EndAt,
    List<Guid>? GoalIds);

public sealed record UpdateEventRequest(
    string Title,
    DateTimeOffset? StartAt,
    DateTimeOffset? EndAt,
    List<Guid>? GoalIds);

public sealed record SetEventStatusRequest(EventStatus Status);

// Goals
public sealed record GoalDto(
    Guid Id,
    Guid UserId,
    string Title,
    string? Description,
    string Status,
    DateTimeOffset CreatedAt,
    List<CheckpointDto> Checkpoints)
{
    public static GoalDto FromEntity(Goal g) => new(
        g.Id, g.UserId, g.Title, g.Description,
        g.Status.ToString(), g.CreatedAt,
        g.Checkpoints.Select(CheckpointDto.FromEntity).ToList());
}

public sealed record CreateGoalRequest(string Title, string? Description);
public sealed record UpdateGoalRequest(string Title, string? Description);
public sealed record SetGoalStatusRequest(GoalStatus Status);

// Checkpoints
public sealed record CheckpointDto(
    Guid Id,
    Guid GoalId,
    string Title,
    decimal PlannedProgress,
    DateTimeOffset? TargetDate,
    string Status,
    DateTimeOffset CreatedAt)
{
    public static CheckpointDto FromEntity(Checkpoint c) => new(
        c.Id, c.GoalId, c.Title, c.PlannedProgress,
        c.TargetDate, c.Status.ToString(), c.CreatedAt);
}

public sealed record CreateCheckpointRequest(string Title, decimal PlannedProgress, DateTimeOffset? TargetDate);
public sealed record UpdateCheckpointRequest(string Title, decimal PlannedProgress, DateTimeOffset? TargetDate);
public sealed record SetCheckpointStatusRequest(CheckpointStatus Status);

// Recommendations
public sealed record RecommendationDto(int Tier, EventDto Event);

// UserSettings
public sealed record UserSettingsDto(Guid UserId, int MaxFocusGoals, string DayBoundaryTime, string Timezone)
{
    public static UserSettingsDto FromEntity(UserSettings us, string timezone) => new(
        us.UserId, us.MaxFocusGoals, us.DayBoundaryTime.ToString("HH:mm"), timezone);
}

public sealed record UpdateUserSettingsRequest(int MaxFocusGoals, string DayBoundaryTime, string Timezone);
