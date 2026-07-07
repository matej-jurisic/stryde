using Stryde.Core.Enums;

namespace Stryde.Core.Entities;

public class Event
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public required string Title { get; set; }
    public DateTimeOffset? StartAt { get; set; }
    public DateTimeOffset? EndAt { get; set; }
    public EventStatus Status { get; set; } = EventStatus.pending;
    public Guid? RepeatRuleId { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public RepeatRule? RepeatRule { get; set; }
    public List<Goal> Goals { get; set; } = [];
}
