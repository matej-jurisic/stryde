using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Stryde.Core.Entities;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;

namespace Stryde.Core.Auth;

public class TokenService(IOptions<JwtOptions> options)
{
    private readonly JwtOptions _opts = options.Value;

    public string CreateAccessToken(User user)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_opts.Secret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new Claim("username", user.Username),
        };

        var token = new JwtSecurityToken(
            issuer: _opts.Issuer,
            audience: _opts.Audience,
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(_opts.AccessTokenMinutes),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public (string RawToken, RefreshToken Entity) CreateRefreshToken(Guid userId)
    {
        var raw = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        var entity = new RefreshToken
        {
            UserId = userId,
            TokenHash = HashRefreshToken(raw),
            ExpiresAt = DateTimeOffset.UtcNow.AddDays(_opts.RefreshTokenDays),
        };
        return (raw, entity);
    }

    public static string HashRefreshToken(string raw) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(raw)));
}
