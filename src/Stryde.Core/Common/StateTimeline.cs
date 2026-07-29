namespace Stryde.Core.Common;

/// <summary>One occurrence putting a state into a value, at the instant it takes effect.</summary>
/// <param name="At">
/// The setting occurrence's end, or its start when it has no end. You are at work once the inbound
/// commute *finishes*, and tired once the workout is over.
/// </param>
/// <param name="DurationMinutes">
/// How long the value holds before decaying back to the state's default, or null for indefinitely.
/// Measured from <paramref name="At"/>.
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
    /// Folds setters into segments. A setter overrides whatever was in force and cancels any pending
    /// expiry, replacing it with its own: an expiry only fires if it is reached before the next
    /// setter, so a second workout that afternoon extends the tiredness rather than being shadowed by
    /// the first one's decay.
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

            Append(setter.At, setter.ValueId);
            pendingExpiry = setter.DurationMinutes is { } d ? setter.At.AddMinutes(d) : null;
        }

        if (pendingExpiry is { } last) Append(last, defaultValueId);

        return new StateTimeline(segments);
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
