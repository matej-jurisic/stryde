using Stryde.Core.Common;
using Stryde.Core.Dtos;
using Stryde.Core.Enums;
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

        // Activity type profiles. All three return the full resolved set, so the client replaces its
        // cache outright rather than patching one row.
        group.MapGet("/activity-types", async (ClaimsPrincipal principal, ActivityProfileService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            return Results.Ok(await svc.GetDtosAsync(userId.Value));
        });

        group.MapPut("/activity-types/{type}", async (
            string type, UpdateActivityProfileRequest req, ClaimsPrincipal principal, ActivityProfileService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            if (!Enum.TryParse<ActivityType>(type, ignoreCase: true, out var parsed))
                return new Error(ErrorType.Validation, "Unknown activity type.").ToProblem();
            var result = await svc.UpdateAsync(userId.Value, parsed, req);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        group.MapDelete("/activity-types/{type}", async (
            string type, ClaimsPrincipal principal, ActivityProfileService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            if (!Enum.TryParse<ActivityType>(type, ignoreCase: true, out var parsed))
                return new Error(ErrorType.Validation, "Unknown activity type.").ToProblem();
            var result = await svc.ResetAsync(userId.Value, parsed);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });
    }
}
