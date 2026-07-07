using Stryde.Core.Dtos;
using Stryde.Core.Services;
using System.Security.Claims;

namespace Stryde.Api.Endpoints;

public static class CheckpointEndpoints
{
    public static void MapCheckpointEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/goals/{goalId:guid}/checkpoints").RequireAuthorization();

        group.MapGet("/", async (Guid goalId, ClaimsPrincipal principal, CheckpointService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var cps = await svc.ListAsync(goalId, userId.Value);
            return Results.Ok(cps);
        });

        group.MapGet("/{id:guid}", async (Guid goalId, Guid id, ClaimsPrincipal principal, CheckpointService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.GetAsync(id, goalId, userId.Value);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        group.MapPost("/", async (Guid goalId, CreateCheckpointRequest req, ClaimsPrincipal principal, CheckpointService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.CreateAsync(goalId, userId.Value, req);
            return result.IsSuccess
                ? Results.Created($"/api/goals/{goalId}/checkpoints/{result.Value!.Id}", result.Value)
                : result.Error!.ToProblem();
        });

        group.MapPut("/{id:guid}", async (Guid goalId, Guid id, UpdateCheckpointRequest req, ClaimsPrincipal principal, CheckpointService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.UpdateAsync(id, goalId, userId.Value, req);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        group.MapDelete("/{id:guid}", async (Guid goalId, Guid id, ClaimsPrincipal principal, CheckpointService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.DeleteAsync(id, goalId, userId.Value);
            return result.IsSuccess ? Results.NoContent() : result.Error!.ToProblem();
        });

        group.MapPost("/{id:guid}/status", async (Guid goalId, Guid id, SetCheckpointStatusRequest req, ClaimsPrincipal principal, CheckpointService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.SetStatusAsync(id, goalId, userId.Value, req.Status);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });
    }
}
