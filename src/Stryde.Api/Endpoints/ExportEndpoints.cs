using Stryde.Core.Services;
using System.Security.Claims;

namespace Stryde.Api.Endpoints;

public static class ExportEndpoints
{
    public static void MapExportEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/export").RequireAuthorization();

        // Markdown, not JSON: the export exists to be read by a person, and there is no import path
        // that would want a machine format back.
        group.MapGet("/", async (ClaimsPrincipal principal, ExportService svc) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var result = await svc.GetMarkdownAsync(userId.Value);
            return result.IsSuccess
                ? Results.Text(result.Value!, "text/markdown; charset=utf-8")
                : result.Error!.ToProblem();
        });
    }
}
