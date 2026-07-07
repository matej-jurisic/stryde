using Microsoft.EntityFrameworkCore;
using Stryde.Api.Auth;
using Stryde.Core.Data;
using Stryde.Core.Dtos;
using Stryde.Core.Services;

namespace Stryde.Api.Endpoints;

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/auth").AllowAnonymous();

        group.MapPost("/register", async (RegisterRequest req, AuthService auth, RefreshCookieManager cookies, HttpContext ctx) =>
        {
            var result = await auth.RegisterAsync(req.Username, req.Password, req.Timezone);
            if (!result.IsSuccess) return result.Error!.ToProblem();
            cookies.SetToken(ctx, result.Value!.RefreshToken, result.Value.RefreshTokenExpiry);
            return Results.Ok(new { accessToken = result.Value.AccessToken, user = result.Value.User });
        });

        group.MapPost("/login", async (LoginRequest req, AuthService auth, RefreshCookieManager cookies, HttpContext ctx) =>
        {
            var result = await auth.LoginAsync(req.Username, req.Password);
            if (!result.IsSuccess) return result.Error!.ToProblem();
            cookies.SetToken(ctx, result.Value!.RefreshToken, result.Value.RefreshTokenExpiry);
            return Results.Ok(new { accessToken = result.Value.AccessToken, user = result.Value.User });
        });

        group.MapPost("/refresh", async (AuthService auth, RefreshCookieManager cookies, HttpContext ctx) =>
        {
            var raw = cookies.GetToken(ctx);
            if (raw is null) return Results.Unauthorized();

            var result = await auth.RefreshAsync(raw);
            if (!result.IsSuccess) return result.Error!.ToProblem();
            cookies.SetToken(ctx, result.Value!.RefreshToken, result.Value.RefreshTokenExpiry);
            return Results.Ok(new { accessToken = result.Value.AccessToken, user = result.Value.User });
        });

        group.MapPost("/logout", async (AuthService auth, RefreshCookieManager cookies, HttpContext ctx) =>
        {
            var raw = cookies.GetToken(ctx);
            if (raw is not null) await auth.LogoutAsync(raw);
            cookies.ClearToken(ctx);
            return Results.NoContent();
        });

        app.MapGet("/api/auth/me", async (System.Security.Claims.ClaimsPrincipal principal, StrydeDbContext db) =>
        {
            var userId = principal.GetUserId();
            if (userId is null) return Results.Unauthorized();
            var user = await db.Users.FindAsync(userId);
            if (user is null) return Results.NotFound();
            return Results.Ok(UserDto.FromEntity(user));
        }).RequireAuthorization();
    }
}
