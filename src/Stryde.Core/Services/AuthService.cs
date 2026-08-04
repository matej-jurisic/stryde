using Microsoft.EntityFrameworkCore;
using Stryde.Core.Auth;
using Stryde.Core.Common;
using Stryde.Core.Data;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;

namespace Stryde.Core.Services;

public class AuthService(StrydeDbContext db, TokenService tokens, PasswordHasher hasher)
{
    public async Task<Result<AuthResult>> RegisterAsync(string username, string password, string timezone)
    {
        if (string.IsNullOrWhiteSpace(username) || username.Length < 3)
            return Result<AuthResult>.Fail(new Error(ErrorType.Validation, "Username must be at least 3 characters."));
        if (string.IsNullOrWhiteSpace(password) || password.Length < 8)
            return Result<AuthResult>.Fail(new Error(ErrorType.Validation, "Password must be at least 8 characters."));

        var exists = await db.Users.AnyAsync(u => u.Username == username);
        if (exists)
            return Result<AuthResult>.Fail(new Error(ErrorType.Conflict, "Username is already taken."));

        var user = new User
        {
            Username = username,
            PasswordHash = hasher.Hash(password),
            Timezone = timezone,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        return await IssueAsync(user);
    }

    public async Task<Result<AuthResult>> LoginAsync(string username, string password)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Username == username);
        if (user is null || !hasher.Verify(password, user.PasswordHash))
            return Result<AuthResult>.Fail(new Error(ErrorType.Unauthorized, "Invalid username or password."));

        return await IssueAsync(user);
    }

    public async Task<Result<AuthResult>> RefreshAsync(string rawToken)
    {
        var hash = TokenService.HashRefreshToken(rawToken);
        var token = await db.RefreshTokens
            .Include(t => t.User)
            .FirstOrDefaultAsync(t => t.TokenHash == hash);

        if (token is null || !token.IsActive)
            return Result<AuthResult>.Fail(new Error(ErrorType.Unauthorized, "Invalid or expired refresh token."));

        token.RevokedAt = DateTimeOffset.UtcNow;

        var (newRaw, newEntity) = tokens.CreateRefreshToken(token.UserId);
        token.ReplacedByTokenId = newEntity.Id;
        db.RefreshTokens.Add(newEntity);
        await db.SaveChangesAsync();

        var accessToken = tokens.CreateAccessToken(token.User);
        return Result<AuthResult>.Success(new AuthResult(accessToken, UserDto.FromEntity(token.User), newRaw, newEntity.ExpiresAt));
    }

    public async Task<Result> LogoutAsync(string rawToken)
    {
        var hash = TokenService.HashRefreshToken(rawToken);
        var token = await db.RefreshTokens.FirstOrDefaultAsync(t => t.TokenHash == hash);
        if (token is null || !token.IsActive)
            return Result.Fail(new Error(ErrorType.NotFound, "Token not found."));

        token.RevokedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync();
        return Result.Success();
    }

    private async Task<Result<AuthResult>> IssueAsync(User user)
    {
        var (rawToken, entity) = tokens.CreateRefreshToken(user.Id);
        db.RefreshTokens.Add(entity);
        await db.SaveChangesAsync();

        var accessToken = tokens.CreateAccessToken(user);
        return Result<AuthResult>.Success(new AuthResult(accessToken, UserDto.FromEntity(user), rawToken, entity.ExpiresAt));
    }
}
