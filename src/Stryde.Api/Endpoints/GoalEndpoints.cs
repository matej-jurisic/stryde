using Stryde.Core.Dtos;
using Stryde.Core.Enums;
using Stryde.Core.Services;
using System.Security.Claims;

namespace Stryde.Api.Endpoints;

public static class GoalEndpoints
{
    public static void MapGoalEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/goals").RequireAuthorization();

        group.MapGet("/", async (ClaimsPrincipal principal, GoalService svc, string? status) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();

            GoalStatus? filter = null;
            if (status is not null && Enum.TryParse<GoalStatus>(status, ignoreCase: true, out var parsed))
                filter = parsed;

            var goals = await svc.ListAsync(userId.Value, filter);
            return Results.Ok(goals);
        });

        group.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal principal, GoalService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.GetAsync(id, userId.Value);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        group.MapPost("/", async (CreateGoalRequest req, ClaimsPrincipal principal, GoalService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.CreateAsync(userId.Value, req);
            return result.IsSuccess ? Results.Created($"/api/goals/{result.Value!.Id}", result.Value) : result.Error!.ToProblem();
        });

        group.MapPut("/{id:guid}", async (Guid id, UpdateGoalRequest req, ClaimsPrincipal principal, GoalService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.UpdateAsync(id, userId.Value, req);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        group.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal principal, GoalService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.DeleteAsync(id, userId.Value);
            return result.IsSuccess ? Results.NoContent() : result.Error!.ToProblem();
        });

        group.MapPost("/{id:guid}/status", async (Guid id, SetGoalStatusRequest req, ClaimsPrincipal principal, GoalService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.SetStatusAsync(id, userId.Value, req.Status);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });
    }
}
