using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Stryde.Core.Common;
using Stryde.Core.Data;
using Stryde.Core.Dtos;
using Stryde.Core.Enums;
using Stryde.Core.Llm;

namespace Stryde.Core.Services;

/// <summary>
/// Turns a line of typed English into a <see cref="CaptureDraftDto"/> - a filled-in occurrence form,
/// never a saved row. The model proposes and the user confirms in the normal editor, which is what
/// makes a wrong answer cost a keystroke instead of a bad calendar entry.
/// <para>
/// The division of labour is deliberate. The model does language: which activity is meant, what the
/// thing is called, which steps were listed. It is given no timezone, no day boundary and no
/// arithmetic - it returns a plain local date and clock time and <em>this</em> class turns those into
/// instants, because date maths is exactly what a language model is worst at and what the app
/// already knows how to do.
/// </para>
/// </summary>
public class CaptureService(
    StrydeDbContext db, UserSettingsService settings, ILlmClient llm)
{
    /// <summary>
    /// How many activity titles the prompt may list. Prefill is not free on local hardware, so the
    /// list is capped rather than sent whole; most recently created wins, since that is what a note
    /// is most likely to be about. A user past this cap loses matching on their oldest activities,
    /// not the feature.
    /// </summary>
    private const int MaxListedActivities = 80;

    /// <summary>
    /// Output budget. The schema below tops out well under this even with several subtasks, and
    /// output tokens are the dominant cost of a local call, so the ceiling is set close rather than
    /// generously.
    /// </summary>
    private const int MaxOutputTokens = 400;

    private const int MaxInputLength = 1000;

    /// <summary>
    /// Every field is required. Ollama's constrained decoding is markedly more reliable when the
    /// model is never allowed to omit a key, so "unknown" is expressed as an explicit null.
    /// </summary>
    private const string ResponseSchema = """
    {
      "type": "object",
      "properties": {
        "title":           { "type": "string" },
        "activity":        { "type": ["string", "null"] },
        "date":            { "type": ["string", "null"] },
        "startTime":       { "type": ["string", "null"] },
        "durationMinutes": { "type": ["integer", "null"] },
        "allDay":          { "type": "boolean" },
        "subtasks":        { "type": "array", "items": { "type": "string" } }
      },
      "required": ["title", "activity", "date", "startTime", "durationMinutes", "allDay", "subtasks"]
    }
    """;

    private const string SystemPrompt = """
    You turn one note from a personal planner into a calendar entry.
    Reply with JSON only, matching the schema. No prose, no explanation.

    Rules:
    - title: what the user is doing, in their own words, capitalised. Never put a date or a time in it.
    - activity: if the note clearly refers to one of the listed activities, copy that title EXACTLY,
      character for character. Otherwise null. Never invent a title here and never edit one.
    - date: YYYY-MM-DD. Resolve "tomorrow", "friday", "next week" against the current date given
      below. Null when the note names no day at all.
    - startTime: HH:mm, 24 hour. Null when the note gives no clock time. Words like "morning" or
      "after work" are not clock times: leave it null.
    - durationMinutes: only when the note says how long it takes. Null otherwise.
    - allDay: true only when the thing occupies a whole named day rather than a slot in it.
    - subtasks: the steps the note lists, in the order given. Empty array when it lists none.
    """;

    public async Task<Result<CaptureDraftDto>> ParseAsync(
        Guid userId, string? text, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(text))
            return Result<CaptureDraftDto>.Fail(new Error(ErrorType.Validation, "Write something to capture."));

        if (text.Length > MaxInputLength)
            return Result<CaptureDraftDto>.Fail(new Error(
                ErrorType.Validation, $"Keep the note under {MaxInputLength} characters."));

        var us = await settings.GetOrCreateAsync(userId);
        var options = LlmOptions.Resolve(us);
        if (!options.IsSuccess) return Result<CaptureDraftDto>.Fail(options.Error!);

        var ctx = await settings.GetDayContextAsync(userId);
        var nowLocal = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, ctx.TimeZone);

        // Events are excluded: their activity row is a 1:1 backing row for a single occurrence, not a
        // reusable thing a note can refer to. Muted activities stay in - excluding them from
        // suggestions says nothing about whether the user may log one by hand.
        // Ordered and capped client-side: SQLite cannot ORDER BY a DateTimeOffset. The set is one
        // user's activity list, so pulling it whole and trimming here costs nothing.
        var activities = (await db.Activities
                .AsNoTracking()
                .Where(a => a.UserId == userId && a.Kind == ActivityKind.activity)
                .Select(a => new { a.Id, a.Title, a.CreatedAt })
                .ToListAsync(ct))
            .OrderByDescending(a => a.CreatedAt)
            .Take(MaxListedActivities)
            .ToList();

        var prompt = BuildPrompt(text.Trim(), nowLocal, activities.Select(a => a.Title));

        var completion = await llm.CompleteAsync(
            options.Value!, SystemPrompt, prompt, ResponseSchema, MaxOutputTokens, ct);
        if (!completion.IsSuccess) return Result<CaptureDraftDto>.Fail(completion.Error!);

        var raw = completion.Value!;

        ModelDraft? parsed;
        try
        {
            parsed = JsonSerializer.Deserialize<ModelDraft>(raw.Content, JsonOptions);
        }
        catch (JsonException)
        {
            parsed = null;
        }

        if (parsed is null)
            return Result<CaptureDraftDto>.Fail(new Error(
                ErrorType.Unavailable, "The model's reply was not usable. Try again, or try a different model."));

        // Titles are matched exactly, ignoring case and surrounding space, and nothing looser. A
        // substring match would quietly attach "run" to "Run errands", and an occurrence pointed at
        // the wrong activity corrupts that activity's whole history - its cadence, its habitual start
        // time, every suggestion drawn from it. No match simply means the draft opens as a new event,
        // which the user can redirect in one click. The prompt carries the burden instead: it tells
        // the model to copy a listed title character for character.
        var matched = string.IsNullOrWhiteSpace(parsed.Activity)
            ? null
            : activities.FirstOrDefault(a =>
                string.Equals(a.Title.Trim(), parsed.Activity.Trim(), StringComparison.OrdinalIgnoreCase));

        var title = string.IsNullOrWhiteSpace(parsed.Title) ? text.Trim() : parsed.Title.Trim();
        if (title.Length > 255) title = title[..255];

        var habit = matched is null ? null : await HabitAsync(userId, matched.Id, ctx, ct);
        var (startAt, endAt, isAllDay) = ResolveSchedule(parsed, ctx, habit);

        return Result<CaptureDraftDto>.Success(new CaptureDraftDto(
            title,
            matched?.Id,
            matched?.Title,
            startAt,
            endAt,
            isAllDay,
            parsed.DurationMinutes is > 0 and <= 24 * 60 ? parsed.DurationMinutes : null,
            (parsed.Subtasks ?? [])
                .Select(s => s.Trim())
                .Where(s => s.Length is > 0 and <= 255)
                .Take(20)
                .ToList(),
            new CaptureDiagnosticsDto(
                raw.Model, raw.TotalMs, raw.LoadMs, raw.PromptTokens, raw.OutputTokens, raw.Content)));
    }

    /// <summary>
    /// What the matched activity's own history says about when it happens and for how long. Null
    /// when there is nothing to go on. Same window, same predicate and same maths the recommendation
    /// engine uses, so a captured note and a suggested slot cannot disagree about the user's routine.
    /// </summary>
    private async Task<RecommendationService.ActivityStats?> HabitAsync(
        Guid userId, Guid activityId, DayContext ctx, CancellationToken ct)
    {
        var cutoff = DateTimeOffset.UtcNow.AddDays(-RecommendationService.HistoryWindowDays);

        // The date window is applied in memory: SQLite cannot translate a DateTimeOffset range
        // comparison, so the SQL side is limited to the null check.
        var completed = (await db.Occurrences
                .AsNoTracking()
                .Where(o => o.UserId == userId && o.ActivityId == activityId
                    && o.Status == EventStatus.done && o.StartAt != null)
                .ToListAsync(ct))
            .Where(o => o.StartAt!.Value >= cutoff)
            .ToList();

        return completed.Count == 0 ? null : RecommendationService.ComputeStats(completed, ctx);
    }

    /// <summary>
    /// Turns the model's local date and clock time into instants in the user's timezone.
    /// <para>
    /// A note with no date at all becomes a floating draft rather than one silently pinned to today:
    /// "sometime" is a real answer in this app, and guessing a day here is the kind of confident
    /// wrong answer that is worse than no answer.
    /// </para>
    /// </summary>
    private static (DateTimeOffset? StartAt, DateTimeOffset? EndAt, bool IsAllDay) ResolveSchedule(
        ModelDraft d, DayContext ctx, RecommendationService.ActivityStats? habit)
    {
        if (!DateOnly.TryParseExact(d.Date, "yyyy-MM-dd", out var date)) return (null, null, false);

        var hasTime = TimeOnly.TryParseExact(d.StartTime, ["HH:mm", "H:mm"], out var time);
        if (!hasTime)
        {
            // "work tomorrow" names a day and nothing else, but the activity's own history usually
            // knows the rest. Observed behaviour beats the model's guess here, including its `allDay`
            // flag, which is one line of text against months of evidence - and the rule needs no
            // exception for genuinely all-day activities, because ComputeStats ignores all-day
            // completions when clustering, so those have no habitual start to find in the first place.
            if (habit?.StartMinutes is { } mins)
            {
                var start = InstantForMinutes(date, mins, ctx);
                return (start, habit.DurationMinutes is > 0 ? start.AddMinutes(habit.DurationMinutes.Value) : null, false);
            }

            // Nothing to go on: a day named without a clock time is a date commitment.
            return (Local(date.ToDateTime(TimeOnly.MinValue), ctx), null, true);
        }

        if (d.AllDay) return (Local(date.ToDateTime(TimeOnly.MinValue), ctx), null, true);

        var startAt = Local(date.ToDateTime(time), ctx);
        var end = d.DurationMinutes is > 0 and <= 24 * 60
            ? startAt.AddMinutes(d.DurationMinutes.Value)
            : (DateTimeOffset?)null;

        return (startAt, end, false);
    }

    /// <summary>
    /// Minutes from local midnight, placed on the given day. A time earlier than the day boundary
    /// belongs to the next calendar date - the same rule the rest of the app buckets days by, so a
    /// 01:00 habit on a 04:00 boundary lands where the user would look for it.
    /// </summary>
    private static DateTimeOffset InstantForMinutes(DateOnly day, int minutesFromMidnight, DayContext ctx)
    {
        var time = new TimeOnly(minutesFromMidnight / 60, minutesFromMidnight % 60);
        var calendarDate = time < ctx.DayBoundary ? day.AddDays(1) : day;
        return Local(calendarDate.ToDateTime(time), ctx);
    }

    private static DateTimeOffset Local(DateTime local, DayContext ctx) =>
        new(local, ctx.TimeZone.GetUtcOffset(local));

    /// <summary>
    /// Volatile data last. Ollama reuses a cached prefix across calls, so the fixed preamble ahead of
    /// the note is prefill the second call does not pay for.
    /// </summary>
    private static string BuildPrompt(string note, DateTimeOffset nowLocal, IEnumerable<string> activityTitles)
    {
        var sb = new StringBuilder();
        sb.Append("Current date: ").Append(nowLocal.ToString("yyyy-MM-dd"))
          .Append(" (").Append(nowLocal.DayOfWeek).AppendLine(")");
        sb.Append("Current time: ").AppendLine(nowLocal.ToString("HH:mm"));

        var titles = activityTitles.ToList();
        if (titles.Count > 0)
        {
            sb.AppendLine().AppendLine("Activities:");
            foreach (var t in titles) sb.Append("- ").AppendLine(t);
        }

        sb.AppendLine().Append("Note: ").Append(note);
        return sb.ToString();
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    /// <summary>The model's side of the contract, before any of it is trusted.</summary>
    private sealed record ModelDraft(
        string? Title,
        string? Activity,
        string? Date,
        string? StartTime,
        [property: JsonPropertyName("durationMinutes")] int? DurationMinutes,
        bool AllDay,
        List<string>? Subtasks);

    /// <summary>Proves the server is reachable and says what it has, without generating anything.</summary>
    public async Task<Result<LlmStatusDto>> GetStatusAsync(Guid userId, CancellationToken ct = default)
    {
        var us = await settings.GetOrCreateAsync(userId);
        var options = LlmOptions.Resolve(us);
        if (!options.IsSuccess) return Result<LlmStatusDto>.Fail(options.Error!);

        var models = await llm.ListModelsAsync(options.Value!, ct);
        if (!models.IsSuccess) return Result<LlmStatusDto>.Fail(models.Error!);

        var available = models.Value!;
        return Result<LlmStatusDto>.Success(new LlmStatusDto(
            options.Value!.Model,
            // Ollama accepts a bare name for a ":latest" tag, so the configured model counts as
            // present when either form is listed.
            available.Any(m => string.Equals(m, options.Value!.Model, StringComparison.OrdinalIgnoreCase)
                || string.Equals(m, options.Value!.Model + ":latest", StringComparison.OrdinalIgnoreCase)),
            available));
    }
}
