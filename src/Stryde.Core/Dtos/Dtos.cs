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
    List<GoalSummaryDto> Goals,
    CategorySummaryDto? Category)
{
    public static EventDto FromEntity(Event e, Common.DayContext ctx, DateTimeOffset nowUtc) => new(
        e.Id, e.UserId, e.Title, e.StartAt, e.EndAt,
        e.Status.ToString(), e.RepeatRuleId, e.CreatedAt,
        Common.DayMath.IsOverdue(e, ctx, nowUtc),
        e.Goals.Select(GoalSummaryDto.FromEntity).ToList(),
        e.Category is not null ? CategorySummaryDto.FromEntity(e.Category) : null);
}

public sealed record CategorySummaryDto(Guid Id, string Name, string Color, string? Icon)
{
    public static CategorySummaryDto FromEntity(Entities.Category c) => new(c.Id, c.Name, c.Color, c.Icon);
}

public sealed record GoalSummaryDto(Guid Id, string Title, string Status)
{
    public static GoalSummaryDto FromEntity(Goal g) => new(g.Id, g.Title, g.Status.ToString());
}

public sealed record CreateEventRequest(
    string Title,
    DateTimeOffset? StartAt,
    DateTimeOffset? EndAt,
    List<Guid>? GoalIds,
    Guid? CategoryId,
    Guid? BaseEventId);

public sealed record UpdateEventRequest(
    string Title,
    DateTimeOffset? StartAt,
    DateTimeOffset? EndAt,
    List<Guid>? GoalIds,
    Guid? CategoryId);

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

// Base Events
public sealed record BaseEventSummaryDto(Guid Id, string Title, CategorySummaryDto? Category, List<GoalSummaryDto> Goals)
{
    public static BaseEventSummaryDto FromEntity(BaseEvent b) => new(
        b.Id, b.Title,
        b.Category is not null ? CategorySummaryDto.FromEntity(b.Category) : null,
        b.Goals.Select(GoalSummaryDto.FromEntity).ToList());
}

// Recommendations
// Type is "event" (tiers 1, 2, 4) or "base_event" (tier 3 pattern suggestions)
public sealed record RecommendationDto(int Tier, string Type, EventDto? Event, BaseEventSummaryDto? BaseEvent);

// UserSettings
public sealed record UserSettingsDto(Guid UserId, int MaxFocusGoals, string DayBoundaryTime, string Timezone)
{
    public static UserSettingsDto FromEntity(UserSettings us, string timezone) => new(
        us.UserId, us.MaxFocusGoals, us.DayBoundaryTime.ToString("HH:mm"), timezone);
}

public sealed record UpdateUserSettingsRequest(int MaxFocusGoals, string DayBoundaryTime, string Timezone);
