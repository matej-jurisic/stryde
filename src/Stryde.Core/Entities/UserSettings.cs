namespace Stryde.Core.Entities;

public class UserSettings
{
    public Guid UserId { get; set; }
    public int MaxFocusGoals { get; set; } = 3;
    public TimeOnly DayBoundaryTime { get; set; } = TimeOnly.MinValue;
    /// <summary>How many suggestion ghosts the calendar draws per day.</summary>
    public int MaxCalendarSuggestions { get; set; } = 6;
    public User User { get; set; } = null!;

    /// <summary>
    /// Which state values make a stretch of the day count towards unaccounted time. Empty is the
    /// default and means all of it does.
    /// </summary>
    public List<UnaccountedTimeRequirement> UnaccountedRequirements { get; set; } = [];

    // ── Assistant (local LLM) ──────────────────────────────────────────────
    // Settings rather than appsettings.json because the model server is a moving target the user
    // points at by hand: a different box, a different model pulled this week. Nothing here is a
    // secret, and everything is off by default, so an account that never touches it never pays for
    // any of it.

    /// <summary>Master switch. Off, no assistant feature calls out at all.</summary>
    public bool LlmEnabled { get; set; } = false;

    /// <summary>
    /// Root of the Ollama server, e.g. <c>http://ollama:11434</c>. User-supplied, which in a
    /// multi-user deployment would be a server-side request forgery hole - the request is made by
    /// the API, with the API's network position. Single-user today; gate it before that changes.
    /// </summary>
    public string? LlmBaseUrl { get; set; }

    /// <summary>Model tag as Ollama knows it, e.g. <c>gemma3:27b</c>.</summary>
    public string? LlmModel { get; set; }

    /// <summary>
    /// How long to wait for a completion. Deliberately generous: a 27B on CPU answers in minutes,
    /// and the default HttpClient 100s would cut it off mid-generation.
    /// </summary>
    public int LlmTimeoutSeconds { get; set; } = 180;

    /// <summary>
    /// Ask the model not to emit reasoning tokens. Qwen and friends think by default, and at local
    /// generation speeds every reasoning token is latency spent on output that is thrown away.
    /// Off by default because a model with no thinking mode rejects the flag outright.
    /// </summary>
    public bool LlmNoThink { get; set; } = false;
}
