namespace Stryde.Core.Entities;

/// <summary>
/// "Doing this activity puts this state into this value."
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

    public Activity Activity { get; set; } = null!;
    public StateValue StateValue { get; set; } = null!;
}
