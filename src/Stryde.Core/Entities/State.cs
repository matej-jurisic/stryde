namespace Stryde.Core.Entities;

/// <summary>
/// A user-defined dimension of context the recommendation engine can gate on - "Location",
/// "Tired" - holding an ordered list of possible <see cref="StateValue"/>s.
/// <para>
/// A state's value at a given instant is never stored. It is derived from the user's scheduled
/// occurrences: whatever the most recent occurrence of a state-setting activity put it to, unless
/// that value has since expired (see <see cref="StateValue.DurationMinutes"/>), in which case the
/// state is back to its default. See <c>spec.md</c> -> States.
/// </para>
/// </summary>
public class State
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public required string Name { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public User User { get; set; } = null!;
    public List<StateValue> Values { get; set; } = [];
}
