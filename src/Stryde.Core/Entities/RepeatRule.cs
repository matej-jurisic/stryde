namespace Stryde.Core.Entities;

public class RepeatRule
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string Pattern { get; set; }
    public required string Config { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
