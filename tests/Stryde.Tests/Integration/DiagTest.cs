using System.Net;
using Xunit;

namespace Stryde.Tests.Integration;

public class DiagTest : IDisposable
{
    private readonly StrydeApiFactory _factory = new();
    private readonly HttpClient _client;

    public DiagTest() { _client = _factory.CreateClient(); }

    [Fact]
    public async Task Health_Returns200()
    {
        var res = await _client.GetAsync("/api/health");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    public void Dispose() => _factory.Dispose();
}
