namespace Stryde.Core.Common;

/// <summary>One occurrence putting a state into a value, at the instant it takes effect.</summary>
/// <param name="At">
/// The setting occurrence's end, or its start when it has no end. You are at work once the inbound
/// commute *finishes*, and tired once the workout is over.
/// </param>
/// <param name="DurationMinutes">
/// How long the value holds before decaying back to the state's default, or null for indefinitely.
/// Measured from <paramref name="At"/>. Comes from the setting activity's effect, so two activities
/// putting the state into the same value can hold it for different lengths of time.
/// </param>
public readonly record struct StateSetter(DateTimeOffset At, Guid ValueId, int? DurationMinutes);

/// <summary>
/// What one <see cref="Entities.State"/> held over time, folded from the occurrences that set it.
/// <para>
/// Nothing here is persisted. A state is a *reading* of the schedule rather than a record kept
/// alongside it, which is what stops the two drifting apart: move a commute and the state moves with
/// it. See <c>spec.md</c> -> States.
/// </para>
/// </summary>
public sealed class StateTimeline
{
    /// <summary>
    /// Segment <c>i</c> covers <c>[Start_i, Start_i+1)</c>, and the last one runs to the end of time.
    /// A null value means the state has no default and nothing has set it yet, so no requirement on it
    /// can be satisfied.
    /// </summary>
    private readonly List<(DateTimeOffset Start, Guid? ValueId)> _segments;

    private StateTimeline(List<(DateTimeOffset Start, Guid? ValueId)> segments) => _segments = segments;

    /// <summary>
    /// Folds setters into segments. A setter overrides whatever was in force, and an expiry only
    /// fires if it is reached before the next setter.
    /// <para>
    /// What happens to a pending expiry depends on whether the setter *changes* the value. Setting a
    /// different value replaces the expiry outright, since the departure it was counting down is
    /// over. Re-setting the value already in force takes whichever expiry is further out, so a hike
    /// leaving you tired for two days is not cut to ten hours by an easy run that evening - the
    /// reason durations moved onto the effect in the first place.
    /// </para>
    /// </summary>
    public static StateTimeline Build(Guid? defaultValueId, IEnumerable<StateSetter> setters)
    {
        var segments = new List<(DateTimeOffset Start, Guid? ValueId)>
        {
            (DateTimeOffset.MinValue, defaultValueId),
        };

        void Append(DateTimeOffset start, Guid? valueId)
        {
            // Two events at the same instant collapse, later one winning: an expiry landing exactly
            // where the next setter starts would otherwise leave a zero-length segment behind.
            if (segments[^1].Start == start) segments[^1] = (start, valueId);
            else segments.Add((start, valueId));
        }

        DateTimeOffset? pendingExpiry = null;

        foreach (var setter in setters.OrderBy(s => s.At))
        {
            if (pendingExpiry is { } expiry && expiry <= setter.At)
            {
                Append(expiry, defaultValueId);
                pendingExpiry = null;
            }

            var heldSameValue = segments[^1].ValueId == setter.ValueId;
            var carried = pendingExpiry;

            Append(setter.At, setter.ValueId);

            var own = setter.DurationMinutes is { } d ? setter.At.AddMinutes(d) : (DateTimeOffset?)null;

            // Furthest expiry wins when the value is unchanged, and null means "indefinitely", so it
            // takes the comparison rather than losing it the way a plain Max over nullables would.
            pendingExpiry = !heldSameValue ? own
                : carried is null || own is null ? null
                : carried > own ? carried
                : own;
        }

        if (pendingExpiry is { } last) Append(last, defaultValueId);

        return new StateTimeline(segments);
    }

    /// <summary>
    /// What the state held at one instant: the value, when it took effect and when it stops. Both ends
    /// are null at the ends of the timeline - <c>Since</c> while the state is still on the segment
    /// nothing has touched, <c>Until</c> when the value holds indefinitely.
    /// </summary>
    public (DateTimeOffset? Since, Guid? ValueId, DateTimeOffset? Until) SegmentAt(DateTimeOffset instant)
    {
        var i = _segments.Count - 1;
        while (i > 0 && _segments[i].Start > instant) i--;
        return (
            i == 0 ? null : _segments[i].Start,
            _segments[i].ValueId,
            i + 1 < _segments.Count ? _segments[i + 1].Start : null);
    }

    /// <summary>
    /// The stretches of <c>[from, to)</c> where the state holds one of <paramref name="allowed"/>,
    /// merged and in order. Empty when it never does, which is what silences an activity for the day.
    /// </summary>
    public List<(DateTimeOffset Start, DateTimeOffset End)> IntervalsWhere(
        HashSet<Guid> allowed, DateTimeOffset from, DateTimeOffset to)
    {
        var result = new List<(DateTimeOffset Start, DateTimeOffset End)>();

        for (var i = 0; i < _segments.Count; i++)
        {
            if (_segments[i].ValueId is not { } value || !allowed.Contains(value)) continue;

            var start = _segments[i].Start > from ? _segments[i].Start : from;
            var end = i + 1 < _segments.Count && _segments[i + 1].Start < to ? _segments[i + 1].Start : to;
            if (start >= end) continue;

            // Consecutive allowed segments (Home, then Home again by a different route) are one
            // stretch as far as placement is concerned.
            if (result.Count > 0 && result[^1].End == start) result[^1] = (result[^1].Start, end);
            else result.Add((start, end));
        }

        return result;
    }
}
