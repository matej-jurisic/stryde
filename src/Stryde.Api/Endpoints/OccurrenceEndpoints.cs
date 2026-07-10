using Stryde.Core.Dtos;
using Stryde.Core.Enums;
using Stryde.Core.Services;
using System.Security.Claims;

namespace Stryde.Api.Endpoints;

public static class OccurrenceEndpoints
{
    public static void MapOccurrenceEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/occurrences").RequireAuthorization();

        group.MapGet("/", async (
            ClaimsPrincipal principal, OccurrenceService svc,
            string? status, DateTimeOffset? startFrom, DateTimeOffset? endBefore, bool floating = false) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();

            EventStatus? filter = null;
            if (status is not null && Enum.TryParse<EventStatus>(status, ignoreCase: true, out var parsed))
                filter = parsed;

            return Results.Ok(await svc.ListAsync(userId.Value, filter, startFrom, endBefore, floating));
        });

        group.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal principal, OccurrenceService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.GetAsync(id, userId.Value);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        group.MapPost("/", async (CreateOccurrenceRequest req, ClaimsPrincipal principal, OccurrenceService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.CreateAsync(userId.Value, req);
            return result.IsSuccess
                ? Results.Created($"/api/occurrences/{result.Value!.Id}", result.Value)
                : result.Error!.ToProblem();
        });

        group.MapPut("/{id:guid}", async (Guid id, UpdateOccurrenceRequest req, ClaimsPrincipal principal, OccurrenceService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.UpdateAsync(id, userId.Value, req);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        group.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal principal, OccurrenceService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.DeleteAsync(id, userId.Value);
            return result.IsSuccess ? Results.NoContent() : result.Error!.ToProblem();
        });

        group.MapPost("/{id:guid}/status", async (Guid id, SetOccurrenceStatusRequest req, ClaimsPrincipal principal, OccurrenceService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.SetStatusAsync(id, userId.Value, req.Status);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        group.MapPost("/event", async (CreateEventRequest req, ClaimsPrincipal principal, OccurrenceService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.CreateEventAsync(userId.Value, req);
            return result.IsSuccess
                ? Results.Created($"/api/occurrences/{result.Value!.Id}", result.Value)
                : result.Error!.ToProblem();
        });

        group.MapPut("/{id:guid}/event", async (Guid id, UpdateEventRequest req, ClaimsPrincipal principal, OccurrenceService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.UpdateEventAsync(id, userId.Value, req);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });
    }
}
