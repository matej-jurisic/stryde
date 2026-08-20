using Stryde.Core.Development;

namespace Stryde.Api.Endpoints;

/// <summary>
/// Development-only routes. Mapped from <c>Program.cs</c> only when the environment is Development,
/// so they do not exist in a published app at all - which is also why they are anonymous: a dev
/// database is reached with curl before there is a token to reach it with.
/// </summary>
public static class DevEndpoints
{
    public static void MapDevEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/dev").AllowAnonymous();

        // POST /api/dev/seed?reset=true&username=&weeksBack=&weeksAhead=
        group.MapPost("/seed", async (
            DevDataSeeder seeder,
            string? username,
            bool? reset,
            int? weeksBack,
            int? weeksAhead) =>
        {
            var user = await seeder.ResolveUserAsync(username);
            if (!user.IsSuccess) return user.Error!.ToProblem();

            var result = await seeder.SeedAsync(
                user.Value!.Id,
                reset ?? false,
                weeksBack ?? DevDataSeeder.DefaultWeeksBack,
                weeksAhead ?? DevDataSeeder.DefaultWeeksAhead);

            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });
    }
}
