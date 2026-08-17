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

public sealed record ActivityTypeSummaryDto(Guid Id, string Name, string? Icon)
{
    public static ActivityTypeSummaryDto FromEntity(Entities.ActivityType t) => new(t.Id, t.Name, t.Icon);
}

// Activities
public sealed record ActivityDto(
    Guid Id,
    Guid UserId,
    string Title,
    Guid? CategoryId,
    Guid? GoalId,
    string Kind,
    Guid? ActivityTypeId,
    bool ExcludeFromRecommendations,
    DateTimeOffset CreatedAt,
    CategorySummaryDto? Category,
    GoalSummaryDto? Goal,
    ActivityTypeSummaryDto? Type,
    List<ActivitySubtaskDto> Subtasks,
    List<ActivityStateEffectDto> SetsStateValues,
    List<Guid> RequiredStateValueIds)
{
    public static ActivityDto FromEntity(Activity a) => new(
        a.Id, a.UserId, a.Title, a.CategoryId, a.GoalId, a.Kind.ToString(), a.ActivityTypeId, a.ExcludeFromRecommendations, a.CreatedAt,
        a.Category is not null ? CategorySummaryDto.FromEntity(a.Category) : null,
        a.Goal is not null ? GoalSummaryDto.FromEntity(a.Goal) : null,
        a.Type is not null ? ActivityTypeSummaryDto.FromEntity(a.Type) : null,
        a.Subtasks.OrderBy(s => s.CreatedAt).Select(ActivitySubtaskDto.FromEntity).ToList(),
        a.StateEffects.Select(ActivityStateEffectDto.FromEntity).ToList(),
        a.StateRequirements.Select(r => r.StateValueId).ToList());
}

// One state change this activity causes. The same record serves both directions: an effect is only a
// value plus how long it holds, so a separate request shape would just repeat itself. Values are
// referenced by id rather than nested, because the client already holds the whole state list from
// `GET /api/states` and resolves names from it.
public sealed record ActivityStateEffectDto(Guid StateValueId, int? DurationMinutes)
{
    public static ActivityStateEffectDto FromEntity(ActivityStateEffect e) =>
        new(e.StateValueId, e.DurationMinutes);
}

public sealed record CreateActivityRequest(
    string Title, Guid? CategoryId, Guid? GoalId, Guid? ActivityTypeId = null,
    List<ActivityStateEffectDto>? SetsStateValues = null, List<Guid>? RequiredStateValueIds = null);
public sealed record UpdateActivityRequest(
    string Title, Guid? CategoryId, Guid? GoalId, bool ExcludeFromRecommendations = false,
    Guid? ActivityTypeId = null,
    List<ActivityStateEffectDto>? SetsStateValues = null, List<Guid>? RequiredStateValueIds = null);
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
    Guid Id, Guid StateId, string Name, bool IsDefault, DateTimeOffset CreatedAt)
{
    public static StateValueDto FromEntity(StateValue v) =>
        new(v.Id, v.StateId, v.Name, v.IsDefault, v.CreatedAt);
}

/// <summary>
/// What every state held at one instant. Derived from the schedule per request, so it answers for a
/// future instant as readily as a past one - see <c>spec.md</c> -> States.
/// </summary>
public sealed record StateSnapshotDto(DateTimeOffset At, List<StateSnapshotEntryDto> States);

/// <param name="ValueId">Null when the state has no default and nothing has set it - it satisfies no requirement.</param>
/// <param name="IsDefault">Whether the value in force is the state's default, i.e. nothing is holding it.</param>
/// <param name="Since">When the value took effect; null while nothing has ever set the state.</param>
/// <param name="Until">When it changes next, by expiry or by another setter; null holds indefinitely.</param>
/// <param name="SetBy">
/// Title of the occurrence that set it, null when the value is the untouched default or when the
/// segment began with an expiry decaying back to it.
/// </param>
/// <param name="NextValueName">What it becomes at <paramref name="Until"/>.</param>
public sealed record StateSnapshotEntryDto(
    Guid StateId,
    string StateName,
    Guid? ValueId,
    string? ValueName,
    bool IsDefault,
    DateTimeOffset? Since,
    DateTimeOffset? Until,
    Guid? SetByOccurrenceId,
    string? SetBy,
    string? NextValueName);

public sealed record CreateStateRequest(string Name);
public sealed record UpdateStateRequest(string Name);
public sealed record CreateStateValueRequest(string Name, bool IsDefault = false);
public sealed record UpdateStateValueRequest(string Name, bool IsDefault = false);

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
    DateTimeOffset? SuggestedStartAt,
    // Chained mode only: the suggestions this one is standing on, by title. Null means it would have
    // been suggested anyway - which is what the UI needs to tell a real opening from a conditional one.
    List<string>? UnlockedBy = null);

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

// Export has no DTOs: it is a Markdown document, rendered by ExportMarkdown straight off the entities.

// UserSettings
/// <param name="UnaccountedStateValueIds">
/// Flat, like <c>ActivityDto.RequiredStateValueIds</c>: the values that make time count towards the
/// unaccounted-time stats. Empty means all of it counts.
/// </param>
public sealed record UserSettingsDto(
    Guid UserId, int MaxFocusGoals, string DayBoundaryTime, string Timezone, int MaxCalendarSuggestions,
    List<Guid> UnaccountedStateValueIds,
    bool LlmEnabled, string? LlmBaseUrl, string? LlmModel, int LlmTimeoutSeconds, bool LlmNoThink)
{
    public static UserSettingsDto FromEntity(UserSettings us, string timezone) => new(
        us.UserId, us.MaxFocusGoals, us.DayBoundaryTime.ToString("HH:mm"), timezone, us.MaxCalendarSuggestions,
        us.UnaccountedRequirements.Select(r => r.StateValueId).ToList(),
        us.LlmEnabled, us.LlmBaseUrl, us.LlmModel, us.LlmTimeoutSeconds, us.LlmNoThink);
}

/// <param name="UnaccountedStateValueIds">
/// Null leaves the set untouched and <c>[]</c> clears it, following the activity write path, so a
/// caller that knows nothing about states can still round-trip the other fields.
/// </param>
public sealed record UpdateUserSettingsRequest(
    int MaxFocusGoals, string DayBoundaryTime, string Timezone, int MaxCalendarSuggestions,
    List<Guid>? UnaccountedStateValueIds = null,
    // Every assistant field follows the same null-means-untouched contract as the mask above, so a
    // caller editing the day boundary cannot switch the assistant off by not knowing it exists. For
    // the two strings that leaves "" as the way to clear one.
    bool? LlmEnabled = null, string? LlmBaseUrl = null, string? LlmModel = null,
    int? LlmTimeoutSeconds = null, bool? LlmNoThink = null);

// Assistant (local LLM)

/// <summary>
/// A filled-in occurrence form, not a saved row: the capture endpoint proposes and the user confirms
/// in the ordinary editor. <see cref="ActivityId"/> null means the note matched no existing activity,
/// so the draft opens as a new event.
/// </summary>
public sealed record CaptureDraftDto(
    string Title,
    Guid? ActivityId,
    string? ActivityTitle,
    DateTimeOffset? StartAt,
    DateTimeOffset? EndAt,
    bool IsAllDay,
    /// <summary>
    /// The note framed this as an intention rather than a fixture ("try to fit in a run tomorrow"),
    /// so its times are a window to place it in. Read off the note only: nothing in the app's own
    /// data says whether a thing is committed to, so there is no fallback the way there is for hours.
    /// </summary>
    bool IsPlanned,
    int? DurationMinutes,
    List<string> Subtasks,
    /// <summary>
    /// The occurrence already on the calendar that this draft would duplicate: same activity, same
    /// day. Set means "you have this already" - the row is offered unticked rather than dropped,
    /// since two sessions of one activity in a day are legitimate.
    /// </summary>
    Guid? ExistingOccurrenceId = null);

/// <summary>
/// One capture call's whole answer. A note about one thing yields one draft; a pasted rota or a
/// "work and both commutes" note yields several, which is why the drafts arrive as a list rather
/// than a single form. The cost belongs here rather than on each draft: there was one call,
/// whatever it produced.
/// </summary>
public sealed record CaptureResultDto(
    List<CaptureDraftDto> Drafts,
    CaptureDiagnosticsDto Diagnostics);

/// <summary>
/// What the call cost, shown in the UI rather than logged. Local inference is slow enough that
/// hiding the number would read as the app having hung, and <see cref="RawJson"/> is what makes a
/// disagreement between the model and the draft diagnosable without server access.
/// </summary>
public sealed record CaptureDiagnosticsDto(
    string Model, long TotalMs, long LoadMs, int PromptTokens, int OutputTokens, string RawJson);

public sealed record ParseCaptureRequest(string Text);

public sealed record LlmStatusDto(string Model, bool ModelAvailable, List<string> AvailableModels);

// Activity types
/// <summary>
/// A user-owned scheduling preset. Every field is editable: there is no resolved-versus-declared
/// distinction any more, because the row is the only thing the engine reads.
/// </summary>
public sealed record ActivityTypeDto(
    Guid Id,
    Guid UserId,
    string Name,
    string? Icon,
    string WindowStart,
    string WindowEnd,
    int MinBlockMinutes,
    int MaxPerDay,
    double CadencePriorDays,
    double MinDueFraction,
    DateTimeOffset CreatedAt)
{
    public static ActivityTypeDto FromEntity(Entities.ActivityType t) => new(
        t.Id,
        t.UserId,
        t.Name,
        t.Icon,
        t.WindowStart.ToString("HH:mm"),
        t.WindowEnd.ToString("HH:mm"),
        t.MinBlockMinutes,
        t.MaxPerDay,
        t.CadencePriorDays,
        t.MinDueFraction,
        t.CreatedAt);
}

public sealed record CreateActivityTypeRequest(
    string Name, string? Icon, string WindowStart, string WindowEnd,
    int MinBlockMinutes, int MaxPerDay, double CadencePriorDays, double MinDueFraction);

public sealed record UpdateActivityTypeRequest(
    string Name, string? Icon, string WindowStart, string WindowEnd,
    int MinBlockMinutes, int MaxPerDay, double CadencePriorDays, double MinDueFraction);
