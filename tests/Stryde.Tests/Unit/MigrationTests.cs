using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Stryde.Core.Data;
using Xunit;

namespace Stryde.Tests.Unit;

/// <summary>
/// The deploy applies migrations unattended (<c>Database:MigrateOnStartup</c> is true in
/// docker-compose), and every other test builds its schema with <c>EnsureCreated()</c> - so without
/// this, nothing exercises the migration path at all and a broken migration would first be noticed
/// by the container failing to boot.
/// <para>
/// A file database rather than <c>:memory:</c>: SQLite's ALTER TABLE support is limited enough that
/// EF rebuilds tables, and the file path is what a real deploy runs against.
/// </para>
/// </summary>
public class MigrationTests : IDisposable
{
    /// <summary>The migration immediately before types became rows.</summary>
    private const string BeforeActivityTypes = "20260729230000_ResetRemovedActivityTypes";

    private readonly string _path = Path.Combine(
        Path.GetTempPath(), $"stryde-migrate-{Guid.NewGuid():N}.db");

    private StrydeDbContext NewContext() =>
        new(new DbContextOptionsBuilder<StrydeDbContext>()
            .UseSqlite($"Data Source={_path}")
            .Options);

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        if (File.Exists(_path)) File.Delete(_path);
    }

    [Fact]
    public void Migrate_applies_the_whole_chain_from_empty()
    {
        using var db = NewContext();

        db.Database.Migrate();

        Assert.Empty(db.Database.GetPendingMigrations());
    }

    [Fact]
    public void Migrate_seeds_activity_types_for_a_user_that_predates_them()
    {
        using (var db = NewContext())
        {
            // Stop one migration short, so the user row exists before ActivityTypes does - the
            // situation the deployed database is actually in.
            db.GetService<IMigrator>().Migrate(BeforeActivityTypes);
            db.Database.ExecuteSqlRaw("""
                INSERT INTO "Users" ("Id", "Username", "PasswordHash", "Timezone", "CreatedAt")
                VALUES ('11111111-1111-1111-1111-111111111111', 'existing', 'x', 'UTC',
                        '2026-07-01 00:00:00.0000000+00:00');
                """);
        }

        using (var db = NewContext())
        {
            db.Database.Migrate();

            var types = db.ActivityTypes.AsNoTracking().ToList();
            Assert.Equal(
                ["General", "Training", "Deep work"],
                types.OrderBy(t => t.CreatedAt).Select(t => t.Name));

            // The seed SQL builds ids by hand, so a malformed one would only show up as EF failing
            // to read the row back - which is exactly what materialising the list above proves.
            Assert.All(types, t => Assert.NotEqual(Guid.Empty, t.Id));
            Assert.All(types, t => Assert.Equal(
                Guid.Parse("11111111-1111-1111-1111-111111111111"), t.UserId));

            var deepWork = types.Single(t => t.Name == "Deep work");
            Assert.Equal(new TimeOnly(9, 0), deepWork.WindowStart);
            Assert.Equal(90, deepWork.MinBlockMinutes);
            Assert.Equal(2.5, deepWork.CadencePriorDays);
        }
    }

    [Fact]
    public void Migrate_leaves_existing_activities_typeless_rather_than_dropping_them()
    {
        using (var db = NewContext())
        {
            db.GetService<IMigrator>().Migrate(BeforeActivityTypes);
            db.Database.ExecuteSqlRaw("""
                INSERT INTO "Users" ("Id", "Username", "PasswordHash", "Timezone", "CreatedAt")
                VALUES ('22222222-2222-2222-2222-222222222222', 'existing', 'x', 'UTC',
                        '2026-07-01 00:00:00.0000000+00:00');
                INSERT INTO "Activities"
                    ("Id", "UserId", "Title", "Kind", "Type", "ExcludeFromRecommendations", "CreatedAt")
                VALUES ('33333333-3333-3333-3333-333333333333',
                        '22222222-2222-2222-2222-222222222222', 'leg day', 'activity', 'training', 0,
                        '2026-07-01 00:00:00.0000000+00:00');
                """);
        }

        using (var db = NewContext())
        {
            db.Database.Migrate();

            // The old Type column is dropped rather than mapped across: null is the unconstrained
            // default now, and the activity has to survive the loss of its type.
            var activity = db.Activities.AsNoTracking().Single();
            Assert.Equal("leg day", activity.Title);
            Assert.Null(activity.ActivityTypeId);
        }
    }
}
