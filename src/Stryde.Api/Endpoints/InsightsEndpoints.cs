using Stryde.Core.Services;
using System.Security.Claims;

namespace Stryde.Api.Endpoints;

public static class InsightsEndpoints
{
    public static void MapInsightsEndpoints(this WebApplication app)
    {
        app.MapGet("/api/insights", async (
            ClaimsPrincipal principal,
            int? period,
            InsightsService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var insights = await svc.GetAsync(userId.Value, period ?? 30);
            return Results.Ok(insights);
        }).RequireAuthorization();
    }
}
