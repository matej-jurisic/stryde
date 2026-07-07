using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stryde.Core.Data;

namespace Stryde.Tests.Integration;

public class StrydeApiFactory : WebApplicationFactory<Program>, IDisposable
{
    internal const string TestJwtSecret = "integration-test-secret-key-32-chars-minimum";

    private readonly SqliteConnection _connection;

    public StrydeApiFactory()
    {
        _connection = new SqliteConnection("Data Source=:memory:");
        _connection.Open();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("Jwt:Secret", TestJwtSecret);
        builder.UseSetting("Auth:RefreshCookie:Secure", "false");
        builder.UseSetting("Database:MigrateOnStartup", "false");

        builder.ConfigureServices(services =>
        {
            var descriptor = services.SingleOrDefault(d => d.ServiceType == typeof(DbContextOptions<StrydeDbContext>));
            if (descriptor is not null) services.Remove(descriptor);

            services.AddDbContext<StrydeDbContext>(options =>
                options.UseSqlite(_connection));

            var sp = services.BuildServiceProvider();
            using var scope = sp.CreateScope();
            scope.ServiceProvider.GetRequiredService<StrydeDbContext>().Database.EnsureCreated();
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing) _connection.Dispose();
    }
}
