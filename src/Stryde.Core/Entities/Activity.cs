namespace Stryde.Core.Entities;

public class Activity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public required string Title { get; set; }
    public Guid? CategoryId { get; set; }
    public Guid? GoalId { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public User User { get; set; } = null!;
    public Category? Category { get; set; }
    public Goal? Goal { get; set; }
}
