using System.Net;
using System.Net.Http.Json;
using Xunit;

namespace Stryde.Tests.Integration;

public class AuthTests : IDisposable
{
    private readonly StrydeApiFactory _factory = new();
    private readonly HttpClient _client;

    public AuthTests() => _client = _factory.CreateClient();

    [Fact]
    public async Task Register_Login_RefreshCycle()
    {
        var token = await _client.SetupUserAsync("alice", "password123");
        Assert.NotEmpty(token);

        _client.UseBearer(token);
        var me = await _client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
    }

    [Fact]
    public async Task Register_DuplicateUsername_Returns409()
    {
        await _client.SetupUserAsync("dupuser", "password123");
        var res = await _client.PostAsJsonAsync("/api/auth/register",
            new { username = "dupuser", password = "password123", timezone = "UTC" });
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
    }

    [Fact]
    public async Task Login_WrongPassword_Returns401()
    {
        await _client.SetupUserAsync("bob", "correctpassword");
        var res = await _client.PostAsJsonAsync("/api/auth/login",
            new { username = "bob", password = "wrongpassword" });
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task ProtectedEndpoint_WithoutToken_Returns401()
    {
        var res = await _client.GetAsync("/api/goals");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    public void Dispose() => _factory.Dispose();
}
