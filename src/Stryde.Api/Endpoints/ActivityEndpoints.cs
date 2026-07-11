using Stryde.Core.Dtos;
using Stryde.Core.Services;
using System.Security.Claims;

namespace Stryde.Api.Endpoints;

public static class ActivityEndpoints
{
    public static void MapActivityEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/activities").RequireAuthorization();
        var subtasks = app.MapGroup("/api/activities/{activityId:guid}/subtasks").RequireAuthorization();

        group.MapGet("/", async (ClaimsPrincipal principal, ActivityService svc, Guid? goalId) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            return Results.Ok(await svc.ListAsync(userId.Value, goalId));
        });

        group.MapPost("/", async (CreateActivityRequest req, ClaimsPrincipal principal, ActivityService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.CreateAsync(userId.Value, req);
            return result.IsSuccess
                ? Results.Created($"/api/activities/{result.Value!.Id}", result.Value)
                : result.Error!.ToProblem();
        });

        group.MapPut("/{id:guid}", async (Guid id, UpdateActivityRequest req, ClaimsPrincipal principal, ActivityService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.UpdateAsync(id, userId.Value, req);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        group.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal principal, ActivityService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.DeleteAsync(id, userId.Value);
            return result.IsSuccess ? Results.NoContent() : result.Error!.ToProblem();
        });

        subtasks.MapPost("/", async (Guid activityId, CreateActivitySubtaskRequest req, ClaimsPrincipal principal, ActivitySubtaskService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.CreateAsync(activityId, userId.Value, req);
            return result.IsSuccess
                ? Results.Created($"/api/activities/{activityId}/subtasks/{result.Value!.Id}", result.Value)
                : result.Error!.ToProblem();
        });

        subtasks.MapPut("/{id:guid}", async (Guid activityId, Guid id, UpdateActivitySubtaskRequest req, ClaimsPrincipal principal, ActivitySubtaskService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.UpdateAsync(id, activityId, userId.Value, req);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        subtasks.MapDelete("/{id:guid}", async (Guid activityId, Guid id, ClaimsPrincipal principal, ActivitySubtaskService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.DeleteAsync(id, activityId, userId.Value);
            return result.IsSuccess ? Results.NoContent() : result.Error!.ToProblem();
        });

        subtasks.MapPost("/{id:guid}/toggle", async (Guid activityId, Guid id, ClaimsPrincipal principal, ActivitySubtaskService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.ToggleAsync(id, activityId, userId.Value);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });
    }
}
