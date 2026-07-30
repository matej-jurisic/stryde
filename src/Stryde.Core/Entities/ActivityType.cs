using Stryde.Core.Common;

namespace Stryde.Core.Entities;

/// <summary>
/// A user-authored scheduling preset: the numbers the recommendation engine uses to decide when an
/// activity of this type may be placed, and how often it should come round.
/// <para>
/// Types are rows rather than a fixed enum because a preset that does not fit a real activity is a
/// preset the user should be able to edit or replace. An activity with no type
/// (<see cref="Activity.ActivityTypeId"/> null) is unconstrained - see
/// <see cref="ActivityProfiles.Unconstrained"/>. Nothing here refers to another type, and nothing
/// here expresses a condition: conditions belong to States.
/// </para>
/// </summary>
public class ActivityType
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public required string Name { get; set; }

    /// <summary>Lucide component name, resolved through the client's icon map. Null renders a fallback.</summary>
    public string? Icon { get; set; }

    public TimeOnly WindowStart { get; set; } = ActivityProfiles.Unconstrained.WindowStart;
    public TimeOnly WindowEnd { get; set; } = ActivityProfiles.Unconstrained.WindowEnd;
    public int MinBlockMinutes { get; set; }
    public int MaxPerDay { get; set; }
    public double CadencePriorDays { get; set; } = ActivityProfiles.DefaultCadenceDays;
    public double MinDueFraction { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public User User { get; set; } = null!;
}
