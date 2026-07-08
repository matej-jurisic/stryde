using Stryde.Core.Services;
using System.Security.Claims;

namespace Stryde.Api.Endpoints;

public static class BaseEventEndpoints
{
    public static void MapBaseEventEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/base-events").RequireAuthorization();

        group.MapGet("/search", async (string? q, ClaimsPrincipal principal, BaseEventService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            return Results.Ok(await svc.SearchAsync(userId.Value, q));
        });
    }
}
