using Stryde.Core.Enums;

namespace Stryde.Core.Common;

/// <summary>
/// What an <see cref="ActivityType"/> means to the recommendation engine.
/// </summary>
/// <para>
/// The values below are the built-in defaults. <c>WindowStart</c>, <c>WindowEnd</c>,
/// <c>MinBlockMinutes</c> and <c>MaxPerDay</c> are user-editable per type
/// (<see cref="Entities.ActivityTypeSetting"/>, resolved by <see cref="Services.ActivityProfileService"/>);
/// <c>CadencePriorDays</c> and <c>MinDueFraction</c> are not. Those two are measured against an
/// activity's own history rather than the clock, so a number typed into a form has no predictable
/// effect - they stay engine-internal until there is a way to express them in user language.
/// </para>
/// <param name="WindowStart">
/// Earliest local time a suggestion of this type may be placed at. An activity with a habitual start
/// time ignores the window entirely: observed behaviour beats a declared preference. A window is a
/// preference either way - an activity's state requirements are a hard mask applied on top of it.
/// </param>
/// <param name="WindowEnd">Latest local start time inside the preferred window.</param>
/// <param name="MinBlockMinutes">
/// Contiguous free time the activity needs, regardless of what its history says it usually takes.
/// 0 means "no floor" - fall back to median duration alone.
/// </param>
/// <param name="CadencePriorDays">
/// Assumed gap between completions until history says otherwise. Drives both the no-history score
/// and the fallback for an activity with a single completion.
/// </param>
/// <param name="MaxPerDay">How many may be suggested for one day. 0 = unlimited.</param>
/// <param name="MinDueFraction">
/// Cooldown: how far through its own rhythm an activity must be before it is offered again, as a
/// fraction of the gap between completions (0.5 = halfway to due). Measured per activity from its
/// own history, so one session silences that activity and nothing else - which is what makes a
/// two-sided split alternate. 0 = no cooldown. Ignored for an activity with no completions, whose
/// due-ness is measured from its creation date and would otherwise suppress it for no reason.
/// </param>
public readonly record struct ActivityProfile(
    TimeOnly WindowStart,
    TimeOnly WindowEnd,
    int MinBlockMinutes,
    double CadencePriorDays,
    int MaxPerDay,
    double MinDueFraction = 0);

public static class ActivityProfiles
{
    /// <summary>
    /// Cadence assumed for an unclassified activity, and the numerator that turns a profile's
    /// cadence prior into a comparable score.
    /// </summary>
    public const double DefaultCadenceDays = 7.0;

    /// <summary>
    /// Ceiling on the score an activity with no completions can reach. Its "overdueness" is
    /// measured from its creation date, so an old never-done activity would otherwise run away
    /// with the ranking on the strength of no evidence at all.
    /// </summary>
    public const double MaxColdStartScore = 3.0;

    private static readonly Dictionary<ActivityType, ActivityProfile> Map = new()
    {
        // Unclassified, and the type most activities keep. Widest window and no constraints of any
        // kind: it fits wherever there is room. The window floor matches the engine's historical
        // 08:00 default.
        [ActivityType.general] = new(new(8, 0), new(21, 0), 0, DefaultCadenceDays, 0),

        // A training split repeats every few days, which the 7-day general prior does not describe.
        // The 45 minute floor keeps it out of the cracks a no-history activity would otherwise be
        // sized into at the 30-minute default, and the window clears a working day, since the
        // 09:00-17:00 deepWork window is unusable for it. The cooldown is what produces rest days
        // and alternation; the per-day cap is 2 rather than 1 so a run and a lift can still share a
        // day once each is past its own cooldown.
        [ActivityType.training] = new(new(15, 0), new(21, 0), 45, 2.5, 2, 0.5),

        // The highest block floor: a 30-minute crack is not deep work, and without this it would be
        // offered one, since a no-history activity is sized at the 30-minute default.
        [ActivityType.deepWork] = new(new(9, 0), new(17, 0), 90, 3.0, 2),
    };

    /// <summary>Every type, in declaration order. The canonical order the UI lists them in.</summary>
    public static readonly IReadOnlyList<ActivityType> AllTypes = Enum.GetValues<ActivityType>();

    /// <summary>
    /// The built-in profile, before any user override. Call this only where the defaults themselves
    /// are the subject; the engine reads a *resolved* profile from
    /// <see cref="Services.ActivityProfileService.ResolveAsync"/> instead.
    /// </summary>
    public static ActivityProfile For(ActivityType type) => Map[type];
}
