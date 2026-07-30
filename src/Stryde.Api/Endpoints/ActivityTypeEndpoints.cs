using Stryde.Core.Dtos;
using Stryde.Core.Services;
using System.Security.Claims;

namespace Stryde.Api.Endpoints;

public static class ActivityTypeEndpoints
{
    public static void MapActivityTypeEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/activity-types").RequireAuthorization();

        group.MapGet("/", async (ClaimsPrincipal principal, ActivityTypeService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            return Results.Ok(await svc.ListAsync(userId.Value));
        });

        group.MapPost("/", async (CreateActivityTypeRequest req, ClaimsPrincipal principal, ActivityTypeService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.CreateAsync(userId.Value, req);
            return result.IsSuccess
                ? Results.Created($"/api/activity-types/{result.Value!.Id}", result.Value)
                : result.Error!.ToProblem();
        });

        group.MapPut("/{id:guid}", async (
            Guid id, UpdateActivityTypeRequest req, ClaimsPrincipal principal, ActivityTypeService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.UpdateAsync(id, userId.Value, req);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        group.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal principal, ActivityTypeService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.DeleteAsync(id, userId.Value);
            return result.IsSuccess ? Results.NoContent() : result.Error!.ToProblem();
        });
    }
}
