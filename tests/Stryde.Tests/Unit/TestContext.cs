using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Stryde.Core.Auth;
using Stryde.Core.Data;
using Stryde.Core.Services;

namespace Stryde.Tests.Unit;

public class TestContext : IDisposable
{
    private readonly SqliteConnection _connection;
    public StrydeDbContext Db { get; }
    public AuthService AuthService { get; }
    public GoalService GoalService { get; }
    public EventService EventService { get; }
    public CheckpointService CheckpointService { get; }
    public UserSettingsService UserSettingsService { get; }
    public RecommendationService RecommendationService { get; }

    public TestContext()
    {
        _connection = new SqliteConnection("Data Source=:memory:");
        _connection.Open();

        var options = new DbContextOptionsBuilder<StrydeDbContext>()
            .UseSqlite(_connection)
            .Options;

        Db = new StrydeDbContext(options);
        Db.Database.EnsureCreated();

        var jwtOpts = Microsoft.Extensions.Options.Options.Create(new JwtOptions
        {
            Secret = "test-secret-key-that-is-long-enough-32chars",
            Issuer = "stryde-test",
            Audience = "stryde-test",
        });

        var tokens = new TokenService(jwtOpts);
        var hasher = new PasswordHasher();
        AuthService = new AuthService(Db, tokens, hasher);
        UserSettingsService = new UserSettingsService(Db);
        GoalService = new GoalService(Db, UserSettingsService);
        EventService = new EventService(Db, UserSettingsService);
        CheckpointService = new CheckpointService(Db);
        RecommendationService = new RecommendationService(Db, UserSettingsService);
    }

    public void Dispose()
    {
        Db.Dispose();
        _connection.Dispose();
    }
}
