using Stryde.Core.Entities;

namespace Stryde.Core.Common;

/// <summary>
/// What an <see cref="ActivityType"/> means to the recommendation engine, flattened off the row so
/// the engine never holds an entity.
/// </summary>
/// <param name="WindowStart">
/// Earliest local time a suggestion of this type may be placed at, or null for no window at all.
/// An activity with a habitual start time ignores the window entirely: observed behaviour beats a
/// declared preference. A window is a preference either way - an activity's state requirements are a
/// hard mask applied on top of it.
/// </param>
/// <param name="WindowEnd">
/// Latest local start time inside the preferred window, or null for no window at all. Null on both
/// bounds is the only honest way to say "unconstrained": a wide window is still a window, and its end
/// is a hard limit on placement.
/// </param>
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
    TimeOnly? WindowStart,
    TimeOnly? WindowEnd,
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

    /// <summary>
    /// The window a brand new <see cref="ActivityType"/> row starts with, so the editor opens on a
    /// plausible civil day rather than on midnight-to-midnight. Only a starting point for a row the
    /// user then edits - deliberately *not* what "no type" means, which is no window at all.
    /// </summary>
    public static readonly TimeOnly DefaultWindowStart = new(8, 0);
    public static readonly TimeOnly DefaultWindowEnd = new(21, 0);

    /// <summary>
    /// What an activity with no type gets: no constraints of any kind. No window, no block floor, no
    /// cap, no cooldown - it fits wherever the day has room. "No type" is the unconstrained default,
    /// which is why there is no built-in row standing for it.
    /// <para>
    /// The window is null rather than wide on purpose. A wide window is still a window: its end is a
    /// hard limit on placement, so an 08:00-21:00 "default" silently refused to suggest a typeless
    /// activity for a free evening - while every label in the app promised no constraints. The one
    /// bound a typeless activity still gets is the engine's global civil-hour floor
    /// (RecommendationService.EarliestFallbackStart), which every activity gets regardless of type.
    /// </para>
    /// </summary>
    public static readonly ActivityProfile Unconstrained =
        new(null, null, 0, DefaultCadenceDays, 0);

    /// <summary>
    /// The profile a type row describes. A null row - no type, or an id pointing at nothing - is
    /// <see cref="Unconstrained"/>.
    /// </summary>
    public static ActivityProfile Of(ActivityType? type) =>
        type is null
            ? Unconstrained
            : new(type.WindowStart, type.WindowEnd, type.MinBlockMinutes,
                type.CadencePriorDays, type.MaxPerDay, type.MinDueFraction);
}
