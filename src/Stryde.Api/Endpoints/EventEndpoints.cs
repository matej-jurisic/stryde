using Stryde.Core.Dtos;
using Stryde.Core.Enums;
using Stryde.Core.Services;
using System.Security.Claims;

namespace Stryde.Api.Endpoints;

public static class EventEndpoints
{
    public static void MapEventEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/events").RequireAuthorization();

        group.MapGet("/", async (
            ClaimsPrincipal principal, EventService svc,
            string? status, DateTimeOffset? startFrom, DateTimeOffset? endBefore, bool floating = false) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();

            EventStatus? filter = null;
            if (status is not null && Enum.TryParse<EventStatus>(status, ignoreCase: true, out var parsed))
                filter = parsed;

            var events = await svc.ListAsync(userId.Value, filter, startFrom, endBefore, floating);
            return Results.Ok(events);
        });

        group.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal principal, EventService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.GetAsync(id, userId.Value);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        group.MapPost("/", async (CreateEventRequest req, ClaimsPrincipal principal, EventService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.CreateAsync(userId.Value, req);
            return result.IsSuccess ? Results.Created($"/api/events/{result.Value!.Id}", result.Value) : result.Error!.ToProblem();
        });

        group.MapPut("/{id:guid}", async (Guid id, UpdateEventRequest req, ClaimsPrincipal principal, EventService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.UpdateAsync(id, userId.Value, req);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        group.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal principal, EventService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.DeleteAsync(id, userId.Value);
            return result.IsSuccess ? Results.NoContent() : result.Error!.ToProblem();
        });

        group.MapPost("/{id:guid}/status", async (Guid id, SetEventStatusRequest req, ClaimsPrincipal principal, EventService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.SetStatusAsync(id, userId.Value, req.Status);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });
    }
}
