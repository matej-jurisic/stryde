using Stryde.Core.Enums;

namespace Stryde.Core.Entities;

public class Occurrence
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public Guid ActivityId { get; set; }
    public string? Title { get; set; }
    public DateTimeOffset? StartAt { get; set; }
    public DateTimeOffset? EndAt { get; set; }
    public EventStatus Status { get; set; } = EventStatus.pending;
    public bool IsAllDay { get; set; } = false;
    public bool IsPlanned { get; set; } = false;
    public int? DurationMinutes { get; set; }
    public DateTimeOffset? WindowStart { get; set; }
    public DateTimeOffset? WindowEnd { get; set; }
    public int? WindowDurationMinutes { get; set; }
    public Guid? RepeatRuleId { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public Activity Activity { get; set; } = null!;
    public RepeatRule? RepeatRule { get; set; }
    public ICollection<OccurrenceSubtaskCompletion> SubtaskCompletions { get; set; } = [];
}
