using Stryde.Core.Enums;

namespace Stryde.Core.Entities;

public class Checkpoint
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid GoalId { get; set; }
    public required string Title { get; set; }
    public CheckpointSize Size { get; set; } = CheckpointSize.normal;
    public DateTimeOffset? TargetDate { get; set; }
    public CheckpointStatus Status { get; set; } = CheckpointStatus.pending;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public Goal Goal { get; set; } = null!;
}
