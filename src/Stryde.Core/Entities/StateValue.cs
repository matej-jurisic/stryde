namespace Stryde.Core.Entities;

/// <summary>One value a <see cref="State"/> can hold.</summary>
public class StateValue
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StateId { get; set; }
    public required string Name { get; set; }

    /// <summary>
    /// The value in force before anything has set the state, and the value an expiring value decays
    /// back to. Exactly one per state, enforced by <see cref="Services.StateService"/>.
    /// </summary>
    public bool IsDefault { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public State State { get; set; } = null!;
}
