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

    /// <summary>
    /// How long this value holds after being set, or null for "until something else changes it".
    /// <para>
    /// A duration is what lets a state change back on its own: a workout sets "Tired" for a day and
    /// nothing has to be scheduled to undo it. Expiry always returns the state to its default, since
    /// a value with a duration is by definition a temporary departure from it - a value that should
    /// decay to some *third* value is a sign the state is modelled wrong.
    /// </para>
    /// </summary>
    public int? DurationMinutes { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public State State { get; set; } = null!;
}
