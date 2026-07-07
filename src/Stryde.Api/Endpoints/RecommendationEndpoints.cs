using Stryde.Core.Services;
using System.Security.Claims;

namespace Stryde.Api.Endpoints;

public static class RecommendationEndpoints
{
    public static void MapRecommendationEndpoints(this WebApplication app)
    {
        app.MapGet("/api/recommendations", async (
            DateOnly? date,
            ClaimsPrincipal principal,
            RecommendationService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            // No date means "the user's current day" — the service resolves it in the user's timezone.
            var items = await svc.GetAsync(userId.Value, date);
            return Results.Ok(items);
        }).RequireAuthorization();
    }
}
