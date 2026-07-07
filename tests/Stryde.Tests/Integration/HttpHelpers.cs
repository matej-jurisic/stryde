using System.Net.Http.Json;
using System.Net.Http.Headers;

namespace Stryde.Tests.Integration;

public static class HttpHelpers
{
    public static async Task<string> SetupUserAsync(
        this HttpClient client,
        string username = "testuser",
        string password = "testpass123",
        string timezone = "UTC")
    {
        var res = await client.PostAsJsonAsync("/api/auth/register", new { username, password, timezone });
        res.EnsureSuccessStatusCode();
        var body = await res.Content.ReadFromJsonAsync<AuthResponse>();
        return body!.AccessToken;
    }

    public static async Task<string> LoginAsync(
        this HttpClient client,
        string username = "testuser",
        string password = "testpass123")
    {
        var res = await client.PostAsJsonAsync("/api/auth/login", new { username, password });
        res.EnsureSuccessStatusCode();
        var body = await res.Content.ReadFromJsonAsync<AuthResponse>();
        return body!.AccessToken;
    }

    public static void UseBearer(this HttpClient client, string token)
    {
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
    }

    public static async Task<T> ReadAsync<T>(this HttpResponseMessage response)
    {
        var result = await response.Content.ReadFromJsonAsync<T>();
        return result!;
    }

    private sealed record AuthResponse(string AccessToken, object User);
}
