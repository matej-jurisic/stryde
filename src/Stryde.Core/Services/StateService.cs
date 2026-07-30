using Microsoft.EntityFrameworkCore;
using Stryde.Core.Common;
using Stryde.Core.Data;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;
using Stryde.Core.Enums;

namespace Stryde.Core.Services;

/// <summary>
/// CRUD for <see cref="State"/>s and their values.
/// <para>
/// Value mutations return the whole parent <see cref="StateDto"/> rather than the value alone: the
/// invariants below can change a sibling row (promoting a new default), so a partial response would
/// leave the client's copy contradicting the server.
/// </para>
/// </summary>
public class StateService(StrydeDbContext db)
{
    public async Task<List<StateDto>> ListAsync(Guid userId)
    {
        var states = await db.States
            .AsNoTracking()
            .Include(s => s.Values)
            .Where(s => s.UserId == userId)
            .ToListAsync();

        // SQLite cannot ORDER BY a DateTimeOffset.
        return states.OrderBy(s => s.CreatedAt).Select(StateDto.FromEntity).ToList();
    }

    public async Task<Result<StateDto>> CreateAsync(Guid userId, CreateStateRequest req)
    {
        var err = Validators.ValidateTitle(req.Name, "Name");
        if (err is not null) return Result<StateDto>.Fail(err);

        var state = new State { UserId = userId, Name = req.Name.Trim() };
        db.States.Add(state);
        await db.SaveChangesAsync();
        return Result<StateDto>.Success(StateDto.FromEntity(state));
    }

    public async Task<Result<StateDto>> UpdateAsync(Guid id, Guid userId, UpdateStateRequest req)
    {
        var err = Validators.ValidateTitle(req.Name, "Name");
        if (err is not null) return Result<StateDto>.Fail(err);

        var state = await LoadAsync(id, userId);
        if (state is null) return NotFound();

        state.Name = req.Name.Trim();
        await db.SaveChangesAsync();
        return Result<StateDto>.Success(StateDto.FromEntity(state));
    }

    /// <summary>
    /// Deletes a state along with its values, and with them every effect and requirement pointing at
    /// those values (cascade). Activities referencing it are left alone otherwise, in the same spirit
    /// as deleting a category: the activity survives, it just stops being gated.
    /// </summary>
    public async Task<Result> DeleteAsync(Guid id, Guid userId)
    {
        var state = await db.States.FirstOrDefaultAsync(s => s.Id == id && s.UserId == userId);
        if (state is null) return Result.Fail(new Error(ErrorType.NotFound, "State not found."));

        db.States.Remove(state);
        await db.SaveChangesAsync();
        return Result.Success();
    }

    public async Task<Result<StateDto>> CreateValueAsync(
        Guid stateId, Guid userId, CreateStateValueRequest req)
    {
        var state = await LoadAsync(stateId, userId);
        if (state is null) return NotFound();

        // The first value has to be the default: a state with values but no default has no answer for
        // "what is this before anything sets it", and the engine would have to ignore it.
        var isDefault = req.IsDefault || state.Values.Count == 0;

        var err = Validators.ValidateTitle(req.Name, "Name");
        if (err is not null) return Result<StateDto>.Fail(err);

        if (isDefault)
            foreach (var v in state.Values) v.IsDefault = false;

        var value = new StateValue
        {
            StateId = state.Id,
            Name = req.Name.Trim(),
            IsDefault = isDefault,
        };

        // Explicit Add forces the Added state; the pre-set Guid key would otherwise make change
        // detection treat it as an existing row and issue an UPDATE that matches nothing.
        // Relationship fixup normally puts it on the parent's collection too, hence the guard rather
        // than an unconditional Add - the response is built from that collection.
        db.StateValues.Add(value);
        if (!state.Values.Contains(value)) state.Values.Add(value);

        await db.SaveChangesAsync();
        return Result<StateDto>.Success(StateDto.FromEntity(state));
    }

    public async Task<Result<StateDto>> UpdateValueAsync(
        Guid id, Guid stateId, Guid userId, UpdateStateValueRequest req)
    {
        var state = await LoadAsync(stateId, userId);
        if (state is null) return NotFound();

        var value = state.Values.FirstOrDefault(v => v.Id == id);
        if (value is null) return Result<StateDto>.Fail(new Error(ErrorType.NotFound, "State value not found."));

        // Clearing the flag on the only default would leave the state without one. Choosing the
        // replacement is the user's call, so this is refused rather than guessed at.
        if (!req.IsDefault && value.IsDefault)
            return Fail("A state needs a default value. Make another value the default instead.");

        var err = Validators.ValidateTitle(req.Name, "Name");
        if (err is not null) return Result<StateDto>.Fail(err);

        // Moving the default onto a value that some activity sets *with* an expiry is allowed: that
        // expiry just goes inert (decaying to the default is a no-op, which StateTimeline folds away)
        // and comes back to life if the default moves off again. Refusing here, or quietly clearing
        // durations across other activities, would both be worse than tolerating a dormant number.
        if (req.IsDefault)
            foreach (var v in state.Values) v.IsDefault = v.Id == id;

        value.Name = req.Name.Trim();

        await db.SaveChangesAsync();
        return Result<StateDto>.Success(StateDto.FromEntity(state));
    }

    /// <summary>
    /// Refuses while any activity still sets or requires the value - silently dropping those rows
    /// would change what gets suggested without saying so. Deleting the default promotes the oldest
    /// remaining value, since there is no ambiguity worth a prompt.
    /// </summary>
    public async Task<Result<StateDto>> DeleteValueAsync(Guid id, Guid stateId, Guid userId)
    {
        var state = await LoadAsync(stateId, userId);
        if (state is null) return NotFound();

        var value = state.Values.FirstOrDefault(v => v.Id == id);
        if (value is null) return Result<StateDto>.Fail(new Error(ErrorType.NotFound, "State value not found."));

        var setters = await db.ActivityStateEffects.CountAsync(e => e.StateValueId == id);
        var requirers = await db.ActivityStateRequirements.CountAsync(r => r.StateValueId == id);
        if (setters + requirers > 0)
            return Result<StateDto>.Fail(new Error(ErrorType.Conflict,
                $"{value.Name} is still used by {Plural(setters + requirers, "activity", "activities")}. "
                + "Change those activities first."));

        // Same reasoning as above, one step further out: dropping the row would quietly widen which
        // hours the insights page counts, and nothing on screen would say why the number moved.
        if (await db.UnaccountedTimeRequirements.AnyAsync(r => r.StateValueId == id))
            return Result<StateDto>.Fail(new Error(ErrorType.Conflict,
                $"{value.Name} is still used by the unaccounted-time setting. Change that first."));

        state.Values.Remove(value);
        db.StateValues.Remove(value);

        if (value.IsDefault && state.Values.Count > 0)
            state.Values.OrderBy(v => v.CreatedAt).First().IsDefault = true;

        await db.SaveChangesAsync();
        return Result<StateDto>.Success(StateDto.FromEntity(state));
    }

    /// <summary>
    /// What every state held at one instant, and what put it there. A derivation rather than a lookup -
    /// see <c>spec.md</c> -> States - so asking about a future instant costs the same as a past one.
    /// </summary>
    public async Task<StateSnapshotDto> SnapshotAsync(Guid userId, DateTimeOffset at)
    {
        // The whole table, as the engine does: a setter has unbounded reach, and SQLite cannot filter a
        // DateTimeOffset range in SQL anyway.
        var occurrences = await db.Occurrences
            .AsNoTracking()
            .Include(o => o.Activity)
            .Where(o => o.UserId == userId)
            .ToListAsync();

        var ctx = await LoadContextAsync(userId, occurrences);

        var titleByOccurrence = occurrences.ToDictionary(o => o.Id, o => o.Title ?? o.Activity.Title);

        var entries = new List<StateSnapshotEntryDto>();
        foreach (var state in ctx.States)
        {
            var timeline = ctx.Timelines[state.Id];
            var (since, valueId, until) = timeline.SegmentAt(at);
            var value = valueId is { } id ? state.Values.FirstOrDefault(v => v.Id == id) : null;

            // The segment start is either a setter's instant or an expiry decaying to the default. Only
            // the former has an occurrence to name, and the last setter on that instant is the one whose
            // value is in force.
            var origin = since is { } start && valueId is { } vid
                ? ctx.Setters.LastOrDefault(s => s.StateId == state.Id && s.ValueId == vid && s.At == start)
                : null;

            var next = until is { } end ? timeline.SegmentAt(end).ValueId : null;

            entries.Add(new StateSnapshotEntryDto(
                state.Id,
                state.Name,
                value?.Id,
                value?.Name,
                value?.IsDefault ?? false,
                since,
                until,
                origin?.OccurrenceId,
                origin is not null ? titleByOccurrence.GetValueOrDefault(origin.OccurrenceId) : null,
                next is { } nid ? state.Values.FirstOrDefault(v => v.Id == nid)?.Name : null));
        }

        return new StateSnapshotDto(at, entries);
    }

    /// <summary>
    /// Everything derived from the user's states for one request: a folded timeline per state, each
    /// activity's requirements grouped by the state they constrain, and the setters that produced the
    /// timelines, kept so a value can be explained back to the user.
    /// <para>
    /// Returns <see cref="StateContext.Empty"/> for a user with no states, which is the case that has
    /// to cost nothing - one cheap query and then out.
    /// </para>
    /// </summary>
    /// <param name="candidates">
    /// Occurrences to fold in; filtered by <see cref="SetsState"/> here, so a caller may hand over a
    /// list it already has in memory without pre-filtering it.
    /// </param>
    public async Task<StateContext> LoadContextAsync(Guid userId, IEnumerable<Occurrence> candidates)
    {
        var states = await db.States
            .AsNoTracking()
            .Include(s => s.Values)
            .Where(s => s.UserId == userId)
            .ToListAsync();

        if (states.Count == 0) return StateContext.Empty;

        var effects = await db.ActivityStateEffects
            .AsNoTracking()
            .Where(e => e.Activity.UserId == userId)
            .Select(e => new { e.ActivityId, e.StateId, e.StateValueId, e.DurationMinutes })
            .ToListAsync();

        var requirements = await db.ActivityStateRequirements
            .AsNoTracking()
            .Where(r => r.Activity.UserId == userId)
            .Select(r => new { r.ActivityId, r.StateValueId })
            .ToListAsync();

        var valueById = states.SelectMany(s => s.Values).ToDictionary(v => v.Id);
        var effectsByActivity = effects.GroupBy(e => e.ActivityId).ToDictionary(g => g.Key, g => g.ToList());

        // Sorted here rather than inside the fold so equal instants break on creation order, giving a
        // day with two setters landing on the same minute a stable answer.
        var sources = candidates
            .Where(o => SetsState(o) && effectsByActivity.ContainsKey(o.ActivityId))
            .Select(o => (At: o.EndAt ?? o.StartAt!.Value, o.CreatedAt, o.ActivityId, o.Id))
            .OrderBy(x => x.At)
            .ThenBy(x => x.CreatedAt)
            .ToList();

        var settersByState = new Dictionary<Guid, List<StateSetter>>();
        var origins = new List<StateSetterOrigin>();
        foreach (var (at, _, activityId, occurrenceId) in sources)
            foreach (var effect in effectsByActivity[activityId])
            {
                if (!valueById.TryGetValue(effect.StateValueId, out var value)) continue;
                if (!settersByState.TryGetValue(effect.StateId, out var list))
                    settersByState[effect.StateId] = list = [];
                // The duration comes off the effect, not the value: the same "Tired: Yes" lasts ten
                // hours after a run and two days after a hike.
                list.Add(new StateSetter(at, value.Id, effect.DurationMinutes));
                origins.Add(new StateSetterOrigin(effect.StateId, value.Id, at, occurrenceId));
            }

        var timelines = states.ToDictionary(
            s => s.Id,
            s => StateTimeline.Build(
                s.Values.FirstOrDefault(v => v.IsDefault)?.Id,
                settersByState.GetValueOrDefault(s.Id) ?? []));

        var requirementsByActivity = requirements
            .Where(r => valueById.ContainsKey(r.StateValueId))
            .GroupBy(r => r.ActivityId)
            .ToDictionary(
                g => g.Key,
                g => g.GroupBy(r => valueById[r.StateValueId].StateId)
                    .Select(sg => (StateId: sg.Key, Allowed: sg.Select(r => r.StateValueId).ToHashSet()))
                    .ToList());

        // States keep their creation order, which is the order the states admin and every requirement
        // string use - so a snapshot lists them the same way the rest of the app does.
        return new StateContext(
            states.OrderBy(s => s.CreatedAt).ToList(), timelines, requirementsByActivity, origins);
    }

    /// <summary>
    /// Whether an occurrence sets state at all: on the calendar (<c>pending</c> or <c>done</c>) and
    /// pinned to an instant. Skipping is an explicit decision not to do the thing, and an all-day
    /// planned row says only "sometime that day", which is not an instant a value can take effect at.
    /// See <c>spec.md</c> -> States.
    /// </summary>
    public static bool SetsState(Occurrence o) =>
        o.Status is EventStatus.pending or EventStatus.done
        && o.StartAt is not null
        && !(o.IsAllDay && o.IsPlanned);

    private Task<State?> LoadAsync(Guid id, Guid userId) =>
        db.States.Include(s => s.Values).FirstOrDefaultAsync(s => s.Id == id && s.UserId == userId);

    private static string Plural(int n, string one, string many) => n == 1 ? $"1 {one}" : $"{n} {many}";

    private static Result<StateDto> NotFound() =>
        Result<StateDto>.Fail(new Error(ErrorType.NotFound, "State not found."));

    private static Result<StateDto> Fail(string message) =>
        Result<StateDto>.Fail(new Error(ErrorType.Validation, message));
}

/// <summary>
/// The user's states folded for one request. Built by
/// <see cref="StateService.LoadContextAsync"/> and read by the recommendation engine's gate and by
/// snapshots, so both answer off one derivation of the schedule.
/// </summary>
/// <param name="States">In creation order, the order the rest of the app lists them in.</param>
/// <param name="RequirementsByActivity">
/// Per activity, the values each constrained state may hold. ORed within a state, ANDed across them.
/// Absent activities are unconstrained.
/// </param>
public sealed record StateContext(
    List<State> States,
    Dictionary<Guid, StateTimeline> Timelines,
    Dictionary<Guid, List<(Guid StateId, HashSet<Guid> Allowed)>> RequirementsByActivity,
    List<StateSetterOrigin> Setters)
{
    /// <summary>A user with no states: no timeline to read and nothing gated.</summary>
    public static StateContext Empty { get; } = new([], [], [], []);
}

/// <summary>
/// Which occurrence produced a <see cref="StateSetter"/>. The fold itself has no use for this - it
/// exists so a value can be explained back to the user as "set by the run at 18:00".
/// </summary>
public sealed record StateSetterOrigin(Guid StateId, Guid ValueId, DateTimeOffset At, Guid OccurrenceId);
