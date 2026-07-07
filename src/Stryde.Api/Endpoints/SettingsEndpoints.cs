using Stryde.Core.Dtos;
using Stryde.Core.Services;
using System.Security.Claims;

namespace Stryde.Api.Endpoints;

public static class SettingsEndpoints
{
    public static void MapSettingsEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/settings").RequireAuthorization();

        group.MapGet("/", async (ClaimsPrincipal principal, UserSettingsService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.GetDtoAsync(userId.Value);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        group.MapPut("/", async (UpdateUserSettingsRequest req, ClaimsPrincipal principal, UserSettingsService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.UpdateAsync(userId.Value, req);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });
    }
}
