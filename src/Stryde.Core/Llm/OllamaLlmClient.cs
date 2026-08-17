using System.Diagnostics;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Stryde.Core.Common;

namespace Stryde.Core.Llm;

/// <summary>
/// Ollama's native <c>/api/chat</c>. Not the OpenAI-compatible route: the native one takes a raw
/// JSON Schema in <c>format</c> and returns the server's own timing counters, both of which this
/// app wants.
/// <para>
/// Singleton over one <see cref="HttpClient"/>, with no BaseAddress - the address is per-user and
/// arrives with each call. The per-call deadline is therefore a linked token rather than
/// <see cref="HttpClient.Timeout"/>, which is instance-wide and would be shared across users.
/// </para>
/// </summary>
public sealed class OllamaLlmClient(HttpClient http) : ILlmClient
{
    /// <summary>
    /// How long the server should hold the model in memory after answering. A cold 27B load is
    /// seconds of pure latency on top of an already slow call, and the box is not doing anything
    /// else with the RAM.
    /// </summary>
    private const string KeepAlive = "30m";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<Result<LlmCompletion>> CompleteAsync(
        LlmOptions options,
        string systemPrompt,
        string userPrompt,
        string? jsonSchema = null,
        int maxOutputTokens = 512,
        CancellationToken ct = default)
    {
        var body = new JsonObject
        {
            ["model"] = options.Model,
            ["stream"] = false,
            ["keep_alive"] = KeepAlive,
            ["messages"] = new JsonArray(
                new JsonObject { ["role"] = "system", ["content"] = systemPrompt },
                new JsonObject { ["role"] = "user", ["content"] = userPrompt }),
            ["options"] = new JsonObject
            {
                // Extraction, not writing. Sampling buys nothing here and costs reproducibility.
                ["temperature"] = 0,
                ["num_predict"] = maxOutputTokens,
            },
        };

        if (jsonSchema is not null)
        {
            var parsed = JsonNode.Parse(jsonSchema);
            if (parsed is null)
                return Result<LlmCompletion>.Fail(new Error(ErrorType.Validation, "Invalid response schema."));
            body["format"] = parsed;
        }

        // Only sent when asked for: a model without a thinking mode rejects the field outright, so
        // sending it unconditionally would break every non-reasoning model.
        if (options.NoThink) body["think"] = false;

        return await PostAsync(options, "/api/chat", body, ct);
    }

    private async Task<Result<LlmCompletion>> PostAsync(
        LlmOptions options, string path, JsonObject body, CancellationToken ct)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(options.TimeoutSeconds));

        var started = Stopwatch.GetTimestamp();
        try
        {
            using var res = await http.PostAsJsonAsync(options.BaseUrl + path, body, Json, cts.Token);
            if (!res.IsSuccessStatusCode)
            {
                var detail = await res.Content.ReadAsStringAsync(cts.Token);
                return Result<LlmCompletion>.Fail(new Error(
                    ErrorType.Unavailable, $"The model server returned {(int)res.StatusCode}. {Trim(detail)}"));
            }

            var payload = await res.Content.ReadFromJsonAsync<ChatResponse>(Json, cts.Token);
            var content = payload?.Message?.Content;
            if (string.IsNullOrWhiteSpace(content))
                return Result<LlmCompletion>.Fail(new Error(
                    ErrorType.Unavailable, "The model returned an empty response."));

            // Ollama reports nanoseconds. Fall back to the measured wall clock if it says nothing,
            // so the UI always has a number to show.
            var totalMs = payload!.TotalDuration > 0
                ? payload.TotalDuration / 1_000_000
                : (long)Stopwatch.GetElapsedTime(started).TotalMilliseconds;

            return Result<LlmCompletion>.Success(new LlmCompletion(
                content, payload.Model ?? options.Model, totalMs, payload.LoadDuration / 1_000_000,
                payload.PromptEvalCount, payload.EvalCount));
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return Result<LlmCompletion>.Fail(new Error(
                ErrorType.Unavailable,
                $"The model did not answer within {options.TimeoutSeconds}s. Raise the timeout in Settings, "
                + "or try a smaller model."));
        }
        catch (HttpRequestException e)
        {
            return Result<LlmCompletion>.Fail(new Error(
                ErrorType.Unavailable, $"Could not reach the model server. {Trim(e.Message)}"));
        }
    }

    public async Task<Result<List<string>>> ListModelsAsync(LlmOptions options, CancellationToken ct = default)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        // A tag listing is a directory read, so it does not get the generation budget.
        cts.CancelAfter(TimeSpan.FromSeconds(15));

        try
        {
            using var res = await http.GetAsync(options.BaseUrl + "/api/tags", cts.Token);
            if (!res.IsSuccessStatusCode)
                return Result<List<string>>.Fail(new Error(
                    ErrorType.Unavailable, $"The model server returned {(int)res.StatusCode}."));

            var payload = await res.Content.ReadFromJsonAsync<TagsResponse>(Json, cts.Token);
            return Result<List<string>>.Success(
                payload?.Models?.Select(m => m.Name).Where(n => !string.IsNullOrWhiteSpace(n)).ToList() ?? []);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return Result<List<string>>.Fail(new Error(ErrorType.Unavailable, "The model server did not answer."));
        }
        catch (HttpRequestException e)
        {
            return Result<List<string>>.Fail(new Error(
                ErrorType.Unavailable, $"Could not reach the model server. {Trim(e.Message)}"));
        }
    }

    /// <summary>Upstream error text goes in front of the user, so it is kept to one readable line.</summary>
    private static string Trim(string s)
    {
        s = s.Trim().ReplaceLineEndings(" ");
        return s.Length > 200 ? s[..200] + "..." : s;
    }

    private sealed record ChatMessage(string? Content);

    // Ollama's counters are snake_case, which the Web defaults (camelCase, case-insensitive) do not
    // match - left implicit they silently deserialize to zero and the UI reports a free call.
    private sealed record ChatResponse(
        string? Model,
        ChatMessage? Message,
        [property: JsonPropertyName("total_duration")] long TotalDuration,
        [property: JsonPropertyName("load_duration")] long LoadDuration,
        [property: JsonPropertyName("prompt_eval_count")] int PromptEvalCount,
        [property: JsonPropertyName("eval_count")] int EvalCount);

    private sealed record TagEntry(string Name);

    private sealed record TagsResponse(List<TagEntry>? Models);
}
