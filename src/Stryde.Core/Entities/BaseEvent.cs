namespace Stryde.Core.Entities;

public class BaseEvent
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public Guid? GoalId { get; set; }
    public required string Title { get; set; }
    public Guid? CategoryId { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public User User { get; set; } = null!;
    public Goal? Goal { get; set; }
    public Category? Category { get; set; }
}
