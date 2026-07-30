using Stryde.Core.Common;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;
using Stryde.Core.Enums;
using Stryde.Core.Services;

namespace Stryde.Tests.Unit;

public class StateServiceTests : IDisposable
{
    private readonly TestContext _ctx = new();

    public void Dispose() => _ctx.Dispose();

    private async Task<Guid> CreateUserAsync()
    {
        var user = new User
        {
            Username = "u" + Guid.NewGuid().ToString("N")[..8],
            PasswordHash = "x",
            Timezone = "UTC",
        };
        _ctx.Db.Users.Add(user);
        await _ctx.Db.SaveChangesAsync();
        return user.Id;
    }

    private async Task<StateDto> CreateStateAsync(Guid userId, string name = "Location")
    {
        var result = await _ctx.StateService.CreateAsync(userId, new CreateStateRequest(name));
        return result.Value!;
    }

    [Fact]
    public async Task CreateAsync_rejects_a_blank_name()
    {
        var userId = await CreateUserAsync();

        var result = await _ctx.StateService.CreateAsync(userId, new CreateStateRequest("  "));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
    }

    [Fact]
    public async Task CreateValueAsync_makes_the_first_value_the_default()
    {
        var userId = await CreateUserAsync();
        var state = await CreateStateAsync(userId);

        // Requested as a non-default, but a state with values and no default has no answer for "what
        // is this before anything sets it".
        var result = await _ctx.StateService.CreateValueAsync(
            state.Id, userId, new CreateStateValueRequest("Home"));

        var value = Assert.Single(result.Value!.Values);
        Assert.True(value.IsDefault);
    }

    [Fact]
    public async Task CreateValueAsync_moves_the_default_when_a_later_value_claims_it()
    {
        var userId = await CreateUserAsync();
        var state = await CreateStateAsync(userId);
        await _ctx.StateService.CreateValueAsync(state.Id, userId, new CreateStateValueRequest("Home"));

        var result = await _ctx.StateService.CreateValueAsync(
            state.Id, userId, new CreateStateValueRequest("Work", IsDefault: true));

        Assert.Equal("Work", Assert.Single(result.Value!.Values, v => v.IsDefault).Name);
    }

    [Fact]
    public async Task UpdateValueAsync_refuses_to_clear_the_only_default()
    {
        var userId = await CreateUserAsync();
        var state = await CreateStateAsync(userId);
        var created = await _ctx.StateService.CreateValueAsync(
            state.Id, userId, new CreateStateValueRequest("Home"));
        var home = created.Value!.Values[0];

        var result = await _ctx.StateService.UpdateValueAsync(
            home.Id, state.Id, userId, new UpdateStateValueRequest("Home", IsDefault: false));

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
    }

    [Fact]
    public async Task DeleteValueAsync_refuses_while_an_activity_still_requires_it()
    {
        var userId = await CreateUserAsync();
        var state = await CreateStateAsync(userId);
        await _ctx.StateService.CreateValueAsync(state.Id, userId, new CreateStateValueRequest("Home"));
        var withWork = await _ctx.StateService.CreateValueAsync(
            state.Id, userId, new CreateStateValueRequest("Work"));
        var work = withWork.Value!.Values.Single(v => v.Name == "Work");

        var activity = new Activity { UserId = userId, Title = "commute home" };
        _ctx.Db.Activities.Add(activity);
        _ctx.Db.ActivityStateRequirements.Add(new ActivityStateRequirement
        {
            ActivityId = activity.Id,
            StateValueId = work.Id,
        });
        await _ctx.Db.SaveChangesAsync();

        var result = await _ctx.StateService.DeleteValueAsync(work.Id, state.Id, userId);

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Conflict, result.Error!.Type);
    }

    [Fact]
    public async Task DeleteValueAsync_promotes_the_oldest_survivor_when_the_default_goes()
    {
        var userId = await CreateUserAsync();
        var state = await CreateStateAsync(userId);
        var withHome = await _ctx.StateService.CreateValueAsync(
            state.Id, userId, new CreateStateValueRequest("Home"));
        await _ctx.StateService.CreateValueAsync(state.Id, userId, new CreateStateValueRequest("Work"));
        var home = withHome.Value!.Values[0];

        var result = await _ctx.StateService.DeleteValueAsync(home.Id, state.Id, userId);

        Assert.Equal("Work", Assert.Single(result.Value!.Values, v => v.IsDefault).Name);
    }

    [Fact]
    public async Task DeleteAsync_takes_its_values_and_their_references_with_it()
    {
        var userId = await CreateUserAsync();
        var state = await CreateStateAsync(userId);
        var created = await _ctx.StateService.CreateValueAsync(
            state.Id, userId, new CreateStateValueRequest("Home"));
        var home = created.Value!.Values[0];

        // Deleting a whole state is allowed even while in use, in the same spirit as deleting a
        // category: the activity survives, it just stops being gated.
        var activity = new Activity { UserId = userId, Title = "run" };
        _ctx.Db.Activities.Add(activity);
        _ctx.Db.ActivityStateRequirements.Add(new ActivityStateRequirement
        {
            ActivityId = activity.Id,
            StateValueId = home.Id,
        });
        await _ctx.Db.SaveChangesAsync();

        var result = await _ctx.StateService.DeleteAsync(state.Id, userId);

        Assert.True(result.IsSuccess);
        Assert.Empty(await _ctx.StateService.ListAsync(userId));
        Assert.Empty(_ctx.Db.ActivityStateRequirements);
        Assert.NotNull(await _ctx.Db.Activities.FindAsync(activity.Id));
    }

    [Fact]
    public async Task ListAsync_does_not_leak_another_users_states()
    {
        var mine = await CreateUserAsync();
        var theirs = await CreateUserAsync();
        await CreateStateAsync(theirs);

        Assert.Empty(await _ctx.StateService.ListAsync(mine));
    }

    // --- Snapshots ---

    private static readonly DateTimeOffset Day = new(2026, 7, 30, 0, 0, 0, TimeSpan.Zero);

    /// <summary>A state built directly, so the values keep the order they are given. First is default.</summary>
    private async Task<State> AddStateAsync(Guid userId, string name, params string[] values)
    {
        var state = new State { UserId = userId, Name = name };
        for (var i = 0; i < values.Length; i++)
            state.Values.Add(new StateValue
            {
                StateId = state.Id,
                Name = values[i],
                IsDefault = i == 0,
                CreatedAt = Day.AddSeconds(i),
            });
        _ctx.Db.States.Add(state);
        await _ctx.Db.SaveChangesAsync();
        return state;
    }

    /// <summary>An activity that puts <paramref name="value"/> in force once an occurrence of it ends.</summary>
    private async Task<Activity> AddSetterAsync(
        Guid userId, string title, StateValue value, int? durationMinutes = null)
    {
        var activity = new Activity { UserId = userId, Title = title };
        _ctx.Db.Activities.Add(activity);
        _ctx.Db.ActivityStateEffects.Add(new ActivityStateEffect
        {
            ActivityId = activity.Id,
            StateId = value.StateId,
            StateValueId = value.Id,
            DurationMinutes = durationMinutes,
        });
        await _ctx.Db.SaveChangesAsync();
        return activity;
    }

    private async Task AddOccurrenceAsync(
        Guid userId, Activity activity, DateTimeOffset start, DateTimeOffset end,
        EventStatus status = EventStatus.pending, string? title = null)
    {
        _ctx.Db.Occurrences.Add(new Occurrence
        {
            UserId = userId,
            ActivityId = activity.Id,
            Title = title,
            StartAt = start,
            EndAt = end,
            Status = status,
        });
        await _ctx.Db.SaveChangesAsync();
    }

    [Fact]
    public async Task SnapshotAsync_reports_the_untouched_default()
    {
        var userId = await CreateUserAsync();
        await AddStateAsync(userId, "Location", "Home", "Work");

        var snapshot = await _ctx.StateService.SnapshotAsync(userId, Day.AddHours(10));

        var entry = Assert.Single(snapshot.States);
        Assert.Equal("Location", entry.StateName);
        Assert.Equal("Home", entry.ValueName);
        Assert.True(entry.IsDefault);
        // Nothing to explain at either end: no cause, and no expiry.
        Assert.Null(entry.Since);
        Assert.Null(entry.Until);
        Assert.Null(entry.SetBy);
    }

    [Fact]
    public async Task SnapshotAsync_names_the_occurrence_that_set_the_value()
    {
        var userId = await CreateUserAsync();
        var location = await AddStateAsync(userId, "Location", "Home", "Work");
        var work = location.Values.First(v => v.Name == "Work");
        var commute = await AddSetterAsync(userId, "commute in", work);
        await AddOccurrenceAsync(userId, commute, Day.AddHours(8), Day.AddHours(9));

        var snapshot = await _ctx.StateService.SnapshotAsync(userId, Day.AddHours(10));

        var entry = Assert.Single(snapshot.States);
        Assert.Equal("Work", entry.ValueName);
        Assert.False(entry.IsDefault);
        // The setter fires at the commute's end, not its start.
        Assert.Equal(Day.AddHours(9), entry.Since);
        Assert.Equal("commute in", entry.SetBy);
        // Nothing undoes it and it carries no duration.
        Assert.Null(entry.Until);
    }

    [Fact]
    public async Task SnapshotAsync_before_the_setter_reads_the_default()
    {
        var userId = await CreateUserAsync();
        var location = await AddStateAsync(userId, "Location", "Home", "Work");
        var work = location.Values.First(v => v.Name == "Work");
        var commute = await AddSetterAsync(userId, "commute in", work);
        await AddOccurrenceAsync(userId, commute, Day.AddHours(8), Day.AddHours(9));

        var snapshot = await _ctx.StateService.SnapshotAsync(userId, Day.AddHours(7));

        var entry = Assert.Single(snapshot.States);
        Assert.Equal("Home", entry.ValueName);
        // The commute is what the day holds next, so the default runs out at its end.
        Assert.Equal(Day.AddHours(9), entry.Until);
        Assert.Equal("Work", entry.NextValueName);
    }

    [Fact]
    public async Task SnapshotAsync_reports_when_a_duration_decays_the_value()
    {
        var userId = await CreateUserAsync();
        var tired = await AddStateAsync(userId, "Tired", "No", "Yes");
        var yes = tired.Values.First(v => v.Name == "Yes");
        var run = await AddSetterAsync(userId, "run", yes, durationMinutes: 120);
        await AddOccurrenceAsync(userId, run, Day.AddHours(9), Day.AddHours(10));

        var snapshot = await _ctx.StateService.SnapshotAsync(userId, Day.AddHours(11));

        var entry = Assert.Single(snapshot.States);
        Assert.Equal("Yes", entry.ValueName);
        Assert.Equal(Day.AddHours(10), entry.Since);
        // Two hours from the run's end, with no occurrence saying so.
        Assert.Equal(Day.AddHours(12), entry.Until);
        Assert.Equal("No", entry.NextValueName);
    }

    [Fact]
    public async Task SnapshotAsync_after_a_decay_names_no_setter()
    {
        var userId = await CreateUserAsync();
        var tired = await AddStateAsync(userId, "Tired", "No", "Yes");
        var yes = tired.Values.First(v => v.Name == "Yes");
        var run = await AddSetterAsync(userId, "run", yes, durationMinutes: 120);
        await AddOccurrenceAsync(userId, run, Day.AddHours(9), Day.AddHours(10));

        var snapshot = await _ctx.StateService.SnapshotAsync(userId, Day.AddHours(13));

        var entry = Assert.Single(snapshot.States);
        Assert.Equal("No", entry.ValueName);
        Assert.True(entry.IsDefault);
        // The segment starts at the expiry, which no occurrence caused.
        Assert.Equal(Day.AddHours(12), entry.Since);
        Assert.Null(entry.SetBy);
    }

    [Fact]
    public async Task SnapshotAsync_ignores_a_skipped_setter()
    {
        var userId = await CreateUserAsync();
        var location = await AddStateAsync(userId, "Location", "Home", "Work");
        var work = location.Values.First(v => v.Name == "Work");
        var commute = await AddSetterAsync(userId, "commute in", work);
        await AddOccurrenceAsync(userId, commute, Day.AddHours(8), Day.AddHours(9), EventStatus.skipped);

        var snapshot = await _ctx.StateService.SnapshotAsync(userId, Day.AddHours(10));

        // Skipping is an explicit decision not to go in, so the day never left Home.
        Assert.Equal("Home", Assert.Single(snapshot.States).ValueName);
    }

    [Fact]
    public async Task SnapshotAsync_prefers_the_occurrences_own_title()
    {
        var userId = await CreateUserAsync();
        var location = await AddStateAsync(userId, "Location", "Home", "Work");
        var work = location.Values.First(v => v.Name == "Work");
        var commute = await AddSetterAsync(userId, "commute in", work);
        await AddOccurrenceAsync(userId, commute, Day.AddHours(8), Day.AddHours(9), title: "drive to the office");

        var snapshot = await _ctx.StateService.SnapshotAsync(userId, Day.AddHours(10));

        Assert.Equal("drive to the office", Assert.Single(snapshot.States).SetBy);
    }

    [Fact]
    public async Task SnapshotAsync_returns_no_states_for_a_user_without_any()
    {
        var userId = await CreateUserAsync();

        var snapshot = await _ctx.StateService.SnapshotAsync(userId, Day.AddHours(10));

        Assert.Empty(snapshot.States);
    }
}
