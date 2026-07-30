namespace Stryde.Core.Common;

/// <summary>
/// Set operations on time ranges, shared by everything that reasons about "when is this allowed".
/// Every input is assumed sorted and non-overlapping, which is how <see cref="StateTimeline"/>, the
/// recommendation engine's free slots, and the results here all come out.
/// </summary>
public static class Intervals
{
    /// <summary>
    /// Overlap of two sorted, non-overlapping lists. A linear sweep is enough, and ANDing a stack of
    /// state requirements is just this folded over the stack.
    /// </summary>
    public static List<(DateTimeOffset Start, DateTimeOffset End)> Intersect(
        List<(DateTimeOffset Start, DateTimeOffset End)> a,
        List<(DateTimeOffset Start, DateTimeOffset End)> b)
    {
        var result = new List<(DateTimeOffset Start, DateTimeOffset End)>();
        int i = 0, j = 0;
        while (i < a.Count && j < b.Count)
        {
            var start = a[i].Start > b[j].Start ? a[i].Start : b[j].Start;
            var end = a[i].End < b[j].End ? a[i].End : b[j].End;
            if (start < end) result.Add((start, end));
            if (a[i].End < b[j].End) i++;
            else j++;
        }
        return result;
    }

    /// <summary>
    /// What is left of <c>[from, to)</c> once <paramref name="intervals"/> is taken out of it. Turns
    /// "the stretches that count" into "the stretches that do not", which is how the insights mask
    /// folds into the busy set.
    /// </summary>
    public static List<(DateTimeOffset Start, DateTimeOffset End)> Complement(
        List<(DateTimeOffset Start, DateTimeOffset End)> intervals, DateTimeOffset from, DateTimeOffset to)
    {
        var result = new List<(DateTimeOffset Start, DateTimeOffset End)>();
        var cursor = from;
        foreach (var iv in intervals)
        {
            if (iv.Start > cursor) result.Add((cursor, iv.Start));
            if (iv.End > cursor) cursor = iv.End;
        }
        if (cursor < to) result.Add((cursor, to));
        return result;
    }

    /// <summary>
    /// Merges an unsorted, possibly overlapping list into sorted disjoint runs. Nothing else here
    /// tolerates overlap, so this is the door raw occurrence spans come in through.
    /// </summary>
    public static List<(DateTimeOffset Start, DateTimeOffset End)> Merge(
        IEnumerable<(DateTimeOffset Start, DateTimeOffset End)> intervals)
    {
        var merged = new List<(DateTimeOffset Start, DateTimeOffset End)>();
        foreach (var iv in intervals.OrderBy(x => x.Start))
        {
            if (merged.Count > 0 && iv.Start <= merged[^1].End)
                merged[^1] = (merged[^1].Start, iv.End > merged[^1].End ? iv.End : merged[^1].End);
            else
                merged.Add(iv);
        }
        return merged;
    }
}
