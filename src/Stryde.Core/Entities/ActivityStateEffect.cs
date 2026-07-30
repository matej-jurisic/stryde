namespace Stryde.Core.Entities;

/// <summary>
/// "Doing this activity puts this state into this value, for this long."
/// <para>
/// Keyed by <c>(ActivityId, StateId)</c> rather than by value, which is what structurally stops one
/// activity claiming to set Location to both Home and Work. The effect applies from the setting
/// occurrence's end - you are at work once the inbound commute finishes, and tired once the workout
/// is over - and nothing is written anywhere: the engine folds these into a timeline per request.
/// </para>
/// </summary>
public class ActivityStateEffect
{
    public Guid ActivityId { get; set; }
    public Guid StateId { get; set; }
    public Guid StateValueId { get; set; }

    /// <summary>
    /// How long the value holds after this activity sets it, or null for "until something else
    /// changes it".
    /// <para>
    /// The duration lives on the effect rather than on the value because it describes the *cause*:
    /// "Tired" has no lifetime of its own, but a run leaves you tired for ten hours and a hike for
    /// two days. Expiry always returns the state to its default, so an effect that sets the default
    /// value cannot carry one - see <see cref="Common.Validators.ValidateStateDuration"/>.
    /// </para>
    /// </summary>
    public int? DurationMinutes { get; set; }

    public Activity Activity { get; set; } = null!;
    public StateValue StateValue { get; set; } = null!;
}
