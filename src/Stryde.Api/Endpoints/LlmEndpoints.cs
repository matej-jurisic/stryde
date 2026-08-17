using Stryde.Core.Dtos;
using Stryde.Core.Services;
using System.Security.Claims;

namespace Stryde.Api.Endpoints;

public static class LlmEndpoints
{
    public static void MapLlmEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/llm").RequireAuthorization();

        // Reachability, not generation: this is what Settings calls to prove the address works
        // before anyone waits minutes for a completion.
        group.MapGet("/status", async (ClaimsPrincipal principal, CaptureService svc, CancellationToken ct) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.GetStatusAsync(userId.Value, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        // Returns a draft. Nothing is written: the client opens it in the normal editor and the user
        // presses Create there, through the same validation as anything typed by hand.
        group.MapPost("/capture", async (
            ParseCaptureRequest req, ClaimsPrincipal principal, CaptureService svc, CancellationToken ct) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.ParseAsync(userId.Value, req.Text, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });
    }
}
