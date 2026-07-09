using Stryde.Core.Dtos;
using Stryde.Core.Services;
using System.Security.Claims;

namespace Stryde.Api.Endpoints;

public static class BaseEventEndpoints
{
    public static void MapBaseEventEndpoints(this WebApplication app)
    {
        var goalGroup = app.MapGroup("/api/goals/{goalId:guid}").RequireAuthorization();

        goalGroup.MapGet("/base-events", async (Guid goalId, ClaimsPrincipal principal, BaseEventService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            return Results.Ok(await svc.ListByGoalAsync(goalId, userId.Value));
        });

        goalGroup.MapPost("/base-events", async (Guid goalId, CreateBaseEventRequest req, ClaimsPrincipal principal, BaseEventService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.CreateAsync(goalId, userId.Value, req);
            return result.IsSuccess
                ? Results.Created($"/api/goals/{goalId}/base-events/{result.Value!.Id}", result.Value)
                : result.Error!.ToProblem();
        });

        var group = app.MapGroup("/api/base-events").RequireAuthorization();

        group.MapGet("/goalless", async (ClaimsPrincipal principal, BaseEventService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            return Results.Ok(await svc.ListGoallessAsync(userId.Value));
        });

        group.MapPost("/", async (CreateBaseEventRequest req, ClaimsPrincipal principal, BaseEventService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.CreateAsync(null, userId.Value, req);
            return result.IsSuccess
                ? Results.Created($"/api/base-events/{result.Value!.Id}", result.Value)
                : result.Error!.ToProblem();
        });

        group.MapPut("/{id:guid}", async (Guid id, UpdateBaseEventRequest req, ClaimsPrincipal principal, BaseEventService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.UpdateAsync(id, userId.Value, req);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        group.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal principal, BaseEventService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.DeleteAsync(id, userId.Value);
            return result.IsSuccess ? Results.NoContent() : result.Error!.ToProblem();
        });
    }
}
