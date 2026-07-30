using Microsoft.EntityFrameworkCore;
using Stryde.Core.Common;
using Stryde.Core.Data;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;

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

        state.Values.Remove(value);
        db.StateValues.Remove(value);

        if (value.IsDefault && state.Values.Count > 0)
            state.Values.OrderBy(v => v.CreatedAt).First().IsDefault = true;

        await db.SaveChangesAsync();
        return Result<StateDto>.Success(StateDto.FromEntity(state));
    }

    private Task<State?> LoadAsync(Guid id, Guid userId) =>
        db.States.Include(s => s.Values).FirstOrDefaultAsync(s => s.Id == id && s.UserId == userId);

    private static string Plural(int n, string one, string many) => n == 1 ? $"1 {one}" : $"{n} {many}";

    private static Result<StateDto> NotFound() =>
        Result<StateDto>.Fail(new Error(ErrorType.NotFound, "State not found."));

    private static Result<StateDto> Fail(string message) =>
        Result<StateDto>.Fail(new Error(ErrorType.Validation, message));
}
