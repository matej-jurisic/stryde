using Stryde.Core.Enums;

namespace Stryde.Core.Entities;

public class Goal
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public required string Title { get; set; }
    public string? Description { get; set; }
    public GoalStatus Status { get; set; } = GoalStatus.active;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public List<Checkpoint> Checkpoints { get; set; } = [];
    public List<Event> Events { get; set; } = [];
}
