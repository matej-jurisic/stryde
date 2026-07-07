using Microsoft.Extensions.Options;

namespace Stryde.Api.Auth;

public sealed class RefreshCookieOptions
{
    public bool Secure { get; set; } = true;
    public string Name { get; set; } = "stryde_refresh";
}

public class RefreshCookieManager(IOptions<RefreshCookieOptions> options)
{
    private readonly RefreshCookieOptions _opts = options.Value;

    public string? GetToken(HttpContext ctx)
    {
        if (ctx.Request.Headers.TryGetValue("X-Refresh-Token", out var header) && !string.IsNullOrEmpty(header))
            return header.ToString();

        return ctx.Request.Cookies.TryGetValue(_opts.Name, out var cookie) ? cookie : null;
    }

    public void SetToken(HttpContext ctx, string rawToken, DateTimeOffset expiresAt)
    {
        ctx.Response.Cookies.Append(_opts.Name, rawToken, new Microsoft.AspNetCore.Http.CookieOptions
        {
            HttpOnly = true,
            Secure = _opts.Secure,
            SameSite = SameSiteMode.Strict,
            Path = "/api/auth",
            Expires = expiresAt,
        });
    }

    public void ClearToken(HttpContext ctx)
    {
        ctx.Response.Cookies.Delete(_opts.Name, new Microsoft.AspNetCore.Http.CookieOptions
        {
            Path = "/api/auth",
        });
    }
}
