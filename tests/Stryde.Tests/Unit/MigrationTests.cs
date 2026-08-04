using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
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

    /// <summary>
    /// Microsoft.Data.Sqlite binds a <see cref="Guid"/> parameter as UPPER-case TEXT and SQLite
    /// compares TEXT case-sensitively, so a row whose id was written as lower-case hex lists fine -
    /// <see cref="Guid.Parse(string)"/> ignores case - but matches nothing by key: every update,
    /// delete and FK lookup on it 404s. Listing rows cannot catch that; only a query can.
    /// </summary>
    [Fact]
    public void Migrated_schema_round_trips_a_row_by_id()
    {
        using var db = NewContext();
        db.Database.Migrate();

        var user = new Core.Entities.User { Username = "u", PasswordHash = "x", Timezone = "UTC" };
        db.Users.Add(user);
        db.Activities.Add(new Core.Entities.Activity { UserId = user.Id, Title = "run" });
        db.SaveChanges();

        Assert.NotNull(db.Users.AsNoTracking().FirstOrDefault(u => u.Id == user.Id));
        foreach (var id in db.Activities.AsNoTracking().Select(a => a.Id).ToList())
            Assert.NotNull(db.Activities.AsNoTracking().FirstOrDefault(a => a.Id == id));
    }
}
