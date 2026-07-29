namespace Stryde.Core.Entities;

/// <summary>
/// "Only suggest this activity while the state is one of these values."
/// <para>
/// One row per allowed value, so a requirement is a *set*: rows sharing a state are ORed, and the
/// groups are ANDed. That asymmetry with <see cref="ActivityStateEffect"/> is deliberate - an
/// activity sets one value per state but can accept several.
/// </para>
/// <para>
/// Suggestion-only. A requirement never blocks scheduling something by hand.
/// </para>
/// </summary>
public class ActivityStateRequirement
{
    public Guid ActivityId { get; set; }
    public Guid StateValueId { get; set; }

    public Activity Activity { get; set; } = null!;
    public StateValue StateValue { get; set; } = null!;
}
