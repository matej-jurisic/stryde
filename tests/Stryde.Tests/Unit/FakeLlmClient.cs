using Stryde.Core.Common;
using Stryde.Core.Llm;

namespace Stryde.Tests.Unit;

/// <summary>
/// A model that says whatever the test tells it to. The point of every test using it is the code
/// <em>around</em> the model: which activity a reply resolves to, what a local date becomes in the
/// user's timezone, and what happens when the reply is rubbish.
/// </summary>
public sealed class FakeLlmClient : ILlmClient
{
    /// <summary>Next reply's message content. Set this to the JSON the model would have produced.</summary>
    public string Content { get; set; } = "{}";

    /// <summary>Set to make the next call fail the way an unreachable server does.</summary>
    public Error? Failure { get; set; }

    public List<string> Models { get; set; } = ["test-model"];

    /// <summary>The last prompt sent, so a test can assert on what the model was actually told.</summary>
    public string? LastUserPrompt { get; private set; }

    public int Calls { get; private set; }

    public Task<Result<LlmCompletion>> CompleteAsync(
        LlmOptions options, string systemPrompt, string userPrompt, string? jsonSchema = null,
        int maxOutputTokens = 512, CancellationToken ct = default)
    {
        Calls++;
        LastUserPrompt = userPrompt;

        return Task.FromResult(Failure is not null
            ? Result<LlmCompletion>.Fail(Failure)
            : Result<LlmCompletion>.Success(new LlmCompletion(Content, options.Model, 1234, 0, 100, 50)));
    }

    public Task<Result<List<string>>> ListModelsAsync(LlmOptions options, CancellationToken ct = default) =>
        Task.FromResult(Failure is not null
            ? Result<List<string>>.Fail(Failure)
            : Result<List<string>>.Success(Models));
}
