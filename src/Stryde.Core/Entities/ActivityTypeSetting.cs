using Stryde.Core.Enums;

namespace Stryde.Core.Entities;

/// <summary>
/// A user's override of one <see cref="ActivityType"/>'s scheduling profile.
/// <para>
/// Sparse in two directions: a row exists only for a type the user actually edited, and a null
/// column inside that row means "still the built-in default". Only the fields that genuinely
/// differ are stored, so retuning <see cref="Common.ActivityProfiles"/> still reaches every knob
/// nobody has touched. The engine-internal parameters (cadence prior, cooldown) are deliberately
/// absent - they are not editable, so they have nowhere to be overridden.
/// </para>
/// </summary>
public class ActivityTypeSetting
{
    public Guid UserId { get; set; }
    public ActivityType Type { get; set; }
    public TimeOnly? WindowStart { get; set; }
    public TimeOnly? WindowEnd { get; set; }
    public int? MinBlockMinutes { get; set; }
    public int? MaxPerDay { get; set; }
}
