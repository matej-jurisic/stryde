namespace Stryde.Core.Entities;

/// <summary>
/// "Only measure unaccounted time while the state is one of these values."
/// <para>
/// Same shape and same reading as <see cref="ActivityStateRequirement"/> - one row per allowed
/// value, ORed within a state and ANDed across states - but it constrains a *measurement* rather
/// than a suggestion. Time the set excludes is not counted as empty on the insights page, because it
/// was never the user's to spend: a week away from home is not ten free evenings.
/// </para>
/// <para>
/// No rows at all means every hour counts, which is what an account with no states gets.
/// </para>
/// </summary>
public class UnaccountedTimeRequirement
{
    public Guid UserId { get; set; }
    public Guid StateValueId { get; set; }

    public UserSettings Settings { get; set; } = null!;
    public StateValue StateValue { get; set; } = null!;
}
