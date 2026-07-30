using Stryde.Core.Services;
using System.Security.Claims;

namespace Stryde.Api.Endpoints;

public static class RecommendationEndpoints
{
    public static void MapRecommendationEndpoints(this WebApplication app)
    {
        app.MapGet("/api/recommendations", async (
            DateOnly? date,
            bool? chain,
            ClaimsPrincipal principal,
            RecommendationService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            // No date means "the user's current day" — the service resolves it in the user's timezone.
            // chain is a per-request view of the same day, not a stored preference: the client holds
            // which mode it is looking at and both answers cache side by side.
            var items = await svc.GetAsync(userId.Value, date, chain: chain ?? false);
            return Results.Ok(items);
        }).RequireAuthorization();
    }
}
