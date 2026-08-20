using Microsoft.EntityFrameworkCore;
using Stryde.Core.Common;
using Stryde.Core.Development;
using Stryde.Core.Entities;
using Stryde.Core.Enums;
using Xunit;

namespace Stryde.Tests.Unit;

/// <summary>
/// The seeder writes entities directly, so what is tested here is that it does not contradict the
/// services that normally own those invariants, and that the dataset it produces is one the derived
/// screens can actually say something about.
/// </summary>
public class DevDataSeederTests : IDisposable
{
    private readonly TestContext _ctx = new();

    public void Dispose() => _ctx.Dispose();

    private DevDataSeeder Seeder => new(_ctx.Db, _ctx.UserSettingsService);

    private async Task<User> CreateUserAsync(string? username = null)
    {
        var user = new User
        {
            Username = username ?? "u" + Guid.NewGuid().ToString("N")[..8],
            PasswordHash = "x",
            Timezone = "Europe/Zagreb",
        };
        _ctx.Db.Users.Add(user);
        await _ctx.Db.SaveChangesAsync();
        return user;
    }

    [Fact]
    public async Task SeedAsync_fills_an_empty_account()
    {
        var user = await CreateUserAsync();

        var result = await Seeder.SeedAsync(user.Id, reset: false);

        Assert.True(result.IsSuccess);
        var summary = result.Value!;
        Assert.Equal(user.Username, summary.Username);
        Assert.Equal(5, summary.Categories);
        Assert.Equal(2, summary.States);
        Assert.True(summary.Occurrences > 200, $"only {summary.Occurrences} occurrences");

        Assert.Equal(summary.Activities, await _ctx.Db.Activities.CountAsync(a => a.UserId == user.Id));
        Assert.Equal(summary.Occurrences, await _ctx.Db.Occurrences.CountAsync(o => o.UserId == user.Id));
        Assert.True(await _ctx.Db.ActivityStateEffects.AnyAsync(e => e.Activity.UserId == user.Id));
        Assert.True(await _ctx.Db.ActivityStateRequirements.AnyAsync(r => r.Activity.UserId == user.Id));
        Assert.True(await _ctx.Db.OccurrenceSubtasks.AnyAsync(s => s.Occurrence.UserId == user.Id));
    }

    [Fact]
    public async Task SeedAsync_keeps_the_invariants_the_services_own()
    {
        var user = await CreateUserAsync();

        await Seeder.SeedAsync(user.Id, reset: false);

        var states = await _ctx.Db.States
            .Include(s => s.Values)
            .Where(s => s.UserId == user.Id)
            .ToListAsync();
        Assert.All(states, s => Assert.Equal(1, s.Values.Count(v => v.IsDefault)));

        var effects = await _ctx.Db.ActivityStateEffects
            .Include(e => e.StateValue)
            .Where(e => e.Activity.UserId == user.Id)
            .ToListAsync();
        Assert.NotEmpty(effects);
        // One value per state per activity is structural, but a duration on a change *to* the
        // default value is not - it would decay to itself, and only Validators says so.
        Assert.All(effects, e => Assert.False(e.StateValue.IsDefault && e.DurationMinutes.HasValue));
        Assert.Equal(effects.Count, effects.Select(e => (e.ActivityId, e.StateId)).Distinct().Count());

        // Every type must be one the editor can round-trip, or it is a built-in in disguise.
        var types = await _ctx.Db.ActivityTypes.Where(t => t.UserId == user.Id).ToListAsync();
        Assert.All(types, t => Assert.Contains(t.CadencePriorDays, new[] { 1, 2.5, 7, 14.0 }));
        Assert.All(types, t => Assert.Contains(t.MinDueFraction, new[] { 0, 0.5, 1.0 }));
        Assert.All(types, t => Assert.True(t.WindowStart < t.WindowEnd));
    }

    [Fact]
    public async Task SeedAsync_leaves_the_days_ahead_open_enough_to_recommend_into()
    {
        var user = await CreateUserAsync();
        await Seeder.SeedAsync(user.Id, reset: false);

        var ctx = await _ctx.UserSettingsService.GetDayContextAsync(user.Id);
        var now = DateTimeOffset.UtcNow;
        var tomorrow = DayMath.Today(ctx, now).AddDays(1);

        var recs = await _ctx.RecommendationService.GetAsync(user.Id, tomorrow, now);

        Assert.NotEmpty(recs);
        // The seeded history is what a suggestion is timed off, so at least one should carry a slot.
        Assert.Contains(recs, r => r.SuggestedStartAt is not null);
    }

    [Fact]
    public async Task SeedAsync_produces_history_insights_can_score()
    {
        var user = await CreateUserAsync();
        await Seeder.SeedAsync(user.Id, reset: false);

        var insights = await _ctx.InsightsService.GetAsync(user.Id);

        Assert.NotEmpty(insights.Activities);
        Assert.NotEmpty(insights.Categories);
        Assert.NotNull(insights.AvgUnaccountedMinutesPerDay);
    }

    [Fact]
    public async Task SeedAsync_refuses_a_populated_account_without_reset()
    {
        var user = await CreateUserAsync();
        await Seeder.SeedAsync(user.Id, reset: false);

        var second = await Seeder.SeedAsync(user.Id, reset: false);

        Assert.False(second.IsSuccess);
        Assert.Equal(ErrorType.Conflict, second.Error!.Type);
    }

    [Fact]
    public async Task SeedAsync_with_reset_replaces_rather_than_appends()
    {
        var user = await CreateUserAsync();
        var first = await Seeder.SeedAsync(user.Id, reset: false);

        var second = await Seeder.SeedAsync(user.Id, reset: true);

        Assert.True(second.IsSuccess);
        Assert.Equal(first.Value!.Activities, second.Value!.Activities);
        Assert.Equal(first.Value.ActivityTypes, second.Value.ActivityTypes);
        Assert.Equal(second.Value.Activities, await _ctx.Db.Activities.CountAsync(a => a.UserId == user.Id));
        Assert.Equal(5, await _ctx.Db.Categories.CountAsync(c => c.UserId == user.Id));
        Assert.Equal(2, await _ctx.Db.States.CountAsync(s => s.UserId == user.Id));

        // The login has to survive a reseed.
        Assert.NotNull(await _ctx.Db.Users.FindAsync(user.Id));
        Assert.NotNull(await _ctx.Db.UserSettings.FindAsync(user.Id));
    }

    [Fact]
    public async Task SeedAsync_does_not_touch_another_account()
    {
        var mine = await CreateUserAsync();
        var theirs = await CreateUserAsync();
        await Seeder.SeedAsync(theirs.Id, reset: false);

        await Seeder.SeedAsync(mine.Id, reset: true);

        Assert.True(await _ctx.Db.Occurrences.AnyAsync(o => o.UserId == theirs.Id));
        Assert.True(await _ctx.Db.Categories.AnyAsync(c => c.UserId == theirs.Id));
    }

    [Fact]
    public async Task SeedAsync_reuses_the_types_registration_already_seeded()
    {
        var user = await CreateUserAsync();
        await _ctx.ActivityTypeService.SeedDefaultsAsync(user.Id);
        var seededIds = await _ctx.Db.ActivityTypes
            .Where(t => t.UserId == user.Id)
            .Select(t => t.Id)
            .ToListAsync();

        await Seeder.SeedAsync(user.Id, reset: false);

        var names = await _ctx.Db.ActivityTypes
            .Where(t => t.UserId == user.Id)
            .Select(t => t.Name)
            .ToListAsync();
        Assert.Equal(names.Count, names.Distinct(StringComparer.OrdinalIgnoreCase).Count());
        Assert.All(seededIds, id => Assert.Contains(id, _ctx.Db.ActivityTypes.Select(t => t.Id)));
    }

    [Fact]
    public async Task ResolveUserAsync_takes_the_only_user_when_unnamed()
    {
        var user = await CreateUserAsync();

        var result = await Seeder.ResolveUserAsync(null);

        Assert.True(result.IsSuccess);
        Assert.Equal(user.Id, result.Value!.Id);
    }

    [Fact]
    public async Task ResolveUserAsync_refuses_to_guess_between_two_users()
    {
        await CreateUserAsync("alice");
        await CreateUserAsync("bob");

        var ambiguous = await Seeder.ResolveUserAsync(null);
        var named = await Seeder.ResolveUserAsync("bob");

        Assert.False(ambiguous.IsSuccess);
        Assert.Equal(ErrorType.Conflict, ambiguous.Error!.Type);
        Assert.True(named.IsSuccess);
        Assert.Equal("bob", named.Value!.Username);
    }

    [Fact]
    public async Task SeedAsync_rejects_a_window_it_cannot_generate()
    {
        var user = await CreateUserAsync();

        var result = await Seeder.SeedAsync(user.Id, reset: false, weeksBack: 0);

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
    }
}
