using Stryde.Core.Common;

namespace Stryde.Core.Llm;

/// <summary>
/// One completion, plus what it cost. The timings are not diagnostics for their own sake: local
/// inference is slow enough that the app has to show the user what it is spending, and every
/// decision about where an assistant feature can live is made from these numbers.
/// </summary>
/// <param name="Content">The model's message text. Schema-constrained calls return JSON here.</param>
/// <param name="TotalMs">Wall clock as the server measured it, including any model load.</param>
public sealed record LlmCompletion(
    string Content, string Model, long TotalMs, long LoadMs, int PromptTokens, int OutputTokens);

/// <summary>
/// The seam between the app and whatever is generating text. Exists mainly so tests never open a
/// socket, and so a disabled account short-circuits without any HTTP machinery being constructed.
/// </summary>
public interface ILlmClient
{
    /// <param name="jsonSchema">
    /// A JSON Schema the reply must satisfy, or null for free text. Constraining the shape is also
    /// the cheapest way to constrain the *length*, which at local speeds is the whole cost.
    /// </param>
    /// <param name="maxOutputTokens">
    /// Hard ceiling on generation. Output is by far the most expensive part of a local call, so this
    /// is a real budget rather than a safety net.
    /// </param>
    Task<Result<LlmCompletion>> CompleteAsync(
        LlmOptions options,
        string systemPrompt,
        string userPrompt,
        string? jsonSchema = null,
        int maxOutputTokens = 512,
        CancellationToken ct = default);

    /// <summary>
    /// The models the server has pulled. The cheapest call that proves connectivity end to end, so
    /// it is what the Settings page's "Test connection" uses - no generation, no waiting.
    /// </summary>
    Task<Result<List<string>>> ListModelsAsync(LlmOptions options, CancellationToken ct = default);
}
