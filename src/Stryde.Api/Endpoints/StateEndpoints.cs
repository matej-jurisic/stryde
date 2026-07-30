using Stryde.Core.Dtos;
using Stryde.Core.Services;
using System.Security.Claims;

namespace Stryde.Api.Endpoints;

public static class StateEndpoints
{
    public static void MapStateEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/states").RequireAuthorization();

        // Value writes return the whole parent state: an invariant can move the default onto a sibling,
        // so a response holding only the edited value would leave the client's copy inconsistent.
        var values = app.MapGroup("/api/states/{stateId:guid}/values").RequireAuthorization();

        group.MapGet("/", async (ClaimsPrincipal principal, StateService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            return Results.Ok(await svc.ListAsync(userId.Value));
        });

        // Static segment, so it is declared before nothing that could shadow it - there is no
        // "/api/states/{id}" GET - but it stays above the writes for readability.
        group.MapGet("/snapshot", async (DateTimeOffset? at, ClaimsPrincipal principal, StateService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            return Results.Ok(await svc.SnapshotAsync(userId.Value, at ?? DateTimeOffset.UtcNow));
        });

        group.MapPost("/", async (CreateStateRequest req, ClaimsPrincipal principal, StateService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.CreateAsync(userId.Value, req);
            return result.IsSuccess
                ? Results.Created($"/api/states/{result.Value!.Id}", result.Value)
                : result.Error!.ToProblem();
        });

        group.MapPut("/{id:guid}", async (Guid id, UpdateStateRequest req, ClaimsPrincipal principal, StateService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.UpdateAsync(id, userId.Value, req);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        group.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal principal, StateService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.DeleteAsync(id, userId.Value);
            return result.IsSuccess ? Results.NoContent() : result.Error!.ToProblem();
        });

        values.MapPost("/", async (Guid stateId, CreateStateValueRequest req, ClaimsPrincipal principal, StateService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.CreateValueAsync(stateId, userId.Value, req);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        values.MapPut("/{id:guid}", async (Guid stateId, Guid id, UpdateStateValueRequest req, ClaimsPrincipal principal, StateService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.UpdateValueAsync(id, stateId, userId.Value, req);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        values.MapDelete("/{id:guid}", async (Guid stateId, Guid id, ClaimsPrincipal principal, StateService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.DeleteValueAsync(id, stateId, userId.Value);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });
    }
}
