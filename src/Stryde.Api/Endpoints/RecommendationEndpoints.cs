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
            var effectiveDate = date ?? DateOnly.FromDateTime(DateTime.UtcNow);
            var items = await svc.GetAsync(userId.Value, effectiveDate);
            return Results.Ok(items);
        }).RequireAuthorization();
    }
}
