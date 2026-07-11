namespace Stryde.Core.Entities;

public class ActivitySubtask
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ActivityId { get; set; }
    public required string Title { get; set; }
    public bool IsDone { get; set; } = false;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public Activity Activity { get; set; } = null!;
}
