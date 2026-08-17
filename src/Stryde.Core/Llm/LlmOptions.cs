using Stryde.Core.Common;
using Stryde.Core.Entities;

namespace Stryde.Core.Llm;

/// <summary>
/// Everything one model call needs, resolved off the user's settings row rather than injected
/// configuration: the server address and model are per-user and editable in the app, so the client
/// itself is a stateless singleton that holds none of it.
/// </summary>
public sealed record LlmOptions(string BaseUrl, string Model, int TimeoutSeconds, bool NoThink)
{
    /// <summary>Longest a call may be allowed to run. A slow model is expected; a hung one is not.</summary>
    public const int MaxTimeoutSeconds = 900;

    /// <summary>
    /// Reads a usable configuration out of the settings row, or says why there isn't one. The
    /// disabled and half-configured cases are <see cref="ErrorType.Unavailable"/> rather than
    /// validation errors: nothing the caller sent is wrong, the feature is simply not switched on.
    /// </summary>
    public static Result<LlmOptions> Resolve(UserSettings s)
    {
        if (!s.LlmEnabled)
            return Result<LlmOptions>.Fail(new Error(ErrorType.Unavailable, "The assistant is turned off."));

        if (string.IsNullOrWhiteSpace(s.LlmBaseUrl) || string.IsNullOrWhiteSpace(s.LlmModel))
            return Result<LlmOptions>.Fail(new Error(
                ErrorType.Unavailable, "Set a server address and a model in Settings first."));

        var timeout = s.LlmTimeoutSeconds is > 0 and <= MaxTimeoutSeconds ? s.LlmTimeoutSeconds : 180;

        return Result<LlmOptions>.Success(new LlmOptions(
            s.LlmBaseUrl.TrimEnd('/'), s.LlmModel.Trim(), timeout, s.LlmNoThink));
    }
}
