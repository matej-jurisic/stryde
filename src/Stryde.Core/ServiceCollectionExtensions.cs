using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Stryde.Core.Auth;
using Stryde.Core.Data;
using Stryde.Core.Llm;
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
        services.AddScoped<ActivityTypeService>();
        services.AddScoped<GoalService>();
        services.AddScoped<ActivityService>();
        services.AddScoped<ActivitySubtaskService>();
        services.AddScoped<OccurrenceService>();
        services.AddScoped<CheckpointService>();
        services.AddScoped<RecommendationService>();
        services.AddScoped<CategoryService>();
        services.AddScoped<StateService>();
        services.AddScoped<InsightsService>();
        services.AddScoped<ExportService>();

        // One HttpClient for the whole process, deliberately without a BaseAddress: the model
        // server's address is a per-user setting that arrives with each call. Per-call deadlines are
        // therefore linked cancellation tokens rather than HttpClient.Timeout, which is instance-wide.
        services.AddSingleton(_ => new HttpClient());
        services.AddSingleton<ILlmClient, OllamaLlmClient>();
        services.AddScoped<CaptureService>();

        return services;
    }

    public static void MigrateDatabase(this IServiceProvider services)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<StrydeDbContext>();
        db.Database.Migrate();
    }
}
