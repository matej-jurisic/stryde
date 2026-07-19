using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Stryde.Core.Auth;
using Stryde.Core.Data;
using Stryde.Core.Services;

namespace Stryde.Core;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddStrydeCore(this IServiceCollection services, IConfiguration config)
    {
        services.AddDbContext<StrydeDbContext>(options =>
            options.UseSqlite(config.GetConnectionString("Default") ?? "Data Source=stryde.db"));

        services.Configure<JwtOptions>(config.GetSection(JwtOptions.SectionName));

        services.AddSingleton<TokenService>();
        services.AddScoped<PasswordHasher>();
        services.AddScoped<AuthService>();
        services.AddScoped<UserSettingsService>();
        services.AddScoped<GoalService>();
        services.AddScoped<ActivityService>();
        services.AddScoped<ActivitySubtaskService>();
        services.AddScoped<OccurrenceService>();
        services.AddScoped<CheckpointService>();
        services.AddScoped<RecommendationService>();
        services.AddScoped<CategoryService>();
        services.AddScoped<InsightsService>();
        services.AddScoped<ExportService>();

        return services;
    }

    public static void MigrateDatabase(this IServiceProvider services)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<StrydeDbContext>();
        db.Database.Migrate();
    }
}
