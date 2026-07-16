namespace Stryde.Core.Entities;

public class OccurrenceSubtask
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OccurrenceId { get; set; }
    public required string Title { get; set; }
    public bool IsDone { get; set; } = false;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public Occurrence Occurrence { get; set; } = null!;
}
