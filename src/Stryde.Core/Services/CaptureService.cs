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
/// Turns typed English into <see cref="CaptureDraftDto"/>s - filled-in occurrence forms, never saved
/// rows. The model proposes and the user confirms, which is what makes a wrong answer cost a
/// keystroke instead of a bad calendar entry.
/// <para>
/// A note is not one entry. "work and both commutes", or a pasted week of shifts, is several things
/// on the calendar, so the reply is always a <em>list</em> of drafts - a single-thing note simply
/// returns a list of one. Nothing downstream has a one-draft path.
/// </para>
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
    /// How many entries one note may produce. A pasted rota is the case this exists for; the cap is
    /// what stops a model that has started repeating itself from turning one note into a hundred
    /// rows to review.
    /// </summary>
    private const int MaxEntries = 30;

    /// <summary>
    /// Output budget. A ceiling, not a spend: constrained decoding stops at the closing brace, so a
    /// one-entry note costs what it always did. It has to clear a full <see cref="MaxEntries"/>
    /// reply, because a budget hit mid-array is truncated JSON - the whole note lost, not the tail
    /// of it.
    /// </summary>
    private const int MaxOutputTokens = 2400;

    /// <summary>Long enough to paste a week of shifts into, which is the point of the list form.</summary>
    private const int MaxInputLength = 4000;

    /// <summary>
    /// Every field is required. Ollama's constrained decoding is markedly more reliable when the
    /// model is never allowed to omit a key, so "unknown" is expressed as an explicit null.
    /// </summary>
    private const string ResponseSchema = """
    {
      "type": "object",
      "properties": {
        "entries": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "title":           { "type": "string" },
              "activity":        { "type": ["string", "null"] },
              "date":            { "type": ["string", "null"] },
              "startTime":       { "type": ["string", "null"] },
              "durationMinutes": { "type": ["integer", "null"] },
              "allDay":          { "type": "boolean" },
              "planned":         { "type": "boolean" },
              "subtasks":        { "type": "array", "items": { "type": "string" } }
            },
            "required": ["title", "activity", "date", "startTime", "durationMinutes", "allDay", "planned", "subtasks"]
          }
        }
      },
      "required": ["entries"]
    }
    """;

    private const string SystemPrompt = """
    You are reading one note from someone's personal planner and working out the day it describes.
    Reply with JSON only, matching the schema. No prose, no explanation.

    Read it the way the person who wrote it would. Planner notes are terse and written for someone
    who already knows the routine, so what goes on the calendar is usually more than what is spelled
    out: "work tomorrow, with the commutes" is three things, a pasted rota is one per shift, and one
    line can carry a day, a time and a place at once. Work out what the day actually looks like, then
    write one entry per thing on it. Never merge two days into one entry, and never add something the
    note does not ask for.

    The entries of a note belong to the same day and settle each other. A time stated for one thing
    often places another: something that runs up to it, something that starts when it finishes, two
    things listed in the order they happen. Reason it through and use what the note fixes.

    Leave a field null when the note genuinely leaves it open. A null is not a failure here, it is a
    handoff: the app fills a missing time or length in from that activity's own history, and it knows
    things you cannot see - that this person has left for work at 08:00 for months, that the drive
    home takes an hour. A guess of yours displaces a fact of theirs, so guess at nothing. The app
    also handles timezones, day boundaries and turning your date and time into real instants. Spend
    your effort on the language instead: which activity is meant, what to call it, what steps were
    listed, which times the note really fixes.

    Fields:
    - title: what the person is doing, in their own words, capitalised. Never a date or a time in it.
    - activity: the listed activity this entry refers to, copied EXACTLY, character for character.
      Null when none of them fits. Never invent a title here and never edit one.
      Match on meaning rather than spelling: the note is often written in another language than the
      titles, or abbreviates them. Choose per entry - consecutive lines of one list routinely name
      different activities - and choose the most specific activity the entry supports. Where two
      titles describe the same thing at different levels of detail, a qualifier in the entry decides
      between them: a place, a variant, a note in brackets, wherever it sits and whatever language it
      is in. The plainer title is for an entry that carries no such qualifier.
    - date: YYYY-MM-DD. Resolve "tomorrow", "friday", "next week" against the current date below.
    - startTime: HH:mm, 24 hour, whenever the note fixes one - stated outright, or settled by another
      entry. Placement with nothing behind it is not a clock time: "morning", "after work" on a day
      the note never times.
    - durationMinutes: how long the note says it takes.
    - allDay: true only for something that occupies a whole named day rather than a slot in it.
    - planned: true when the note frames the thing as an intention rather than a fixture - "aim to",
      "try to fit in", "sometime this afternoon", or the person calling it planned in as many words.
      Any times then read as a window to fit it into rather than a commitment, so it is never late.
      False for whatever simply happens at its time: a shift, an appointment, a class, a booking.
    - subtasks: the steps that entry lists, in the order given. Empty array when it lists none.
    """;

    public async Task<Result<CaptureResultDto>> ParseAsync(
        Guid userId, string? text, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(text))
            return Result<CaptureResultDto>.Fail(new Error(ErrorType.Validation, "Write something to capture."));

        if (text.Length > MaxInputLength)
            return Result<CaptureResultDto>.Fail(new Error(
                ErrorType.Validation, $"Keep the note under {MaxInputLength} characters."));

        var us = await settings.GetOrCreateAsync(userId);
        var options = LlmOptions.Resolve(us);
        if (!options.IsSuccess) return Result<CaptureResultDto>.Fail(options.Error!);

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
        if (!completion.IsSuccess) return Result<CaptureResultDto>.Fail(completion.Error!);

        var raw = completion.Value!;

        ModelReply? parsed;
        try
        {
            parsed = JsonSerializer.Deserialize<ModelReply>(raw.Content, JsonOptions);
        }
        catch (JsonException)
        {
            parsed = null;
        }

        if (parsed?.Entries is null)
            return Unusable(raw, "The model's reply was not usable. Try again, or try a different model.");

        if (parsed.Entries.Count == 0)
            return Unusable(raw, "The model found nothing to schedule in that note. Try rewording it.");

        // One activity can appear in several entries - a week of the same shift is the whole point of
        // the list form - and its history is the same history every time, so it is read once.
        var habits = new Dictionary<Guid, RecommendationService.ActivityStats?>();
        var drafts = new List<CaptureDraftDto>();

        foreach (var entry in parsed.Entries.Take(MaxEntries))
        {
            // Titles are matched exactly, ignoring case and surrounding space, and nothing looser. A
            // substring match would quietly attach "run" to "Run errands", and an occurrence pointed
            // at the wrong activity corrupts that activity's whole history - its cadence, its
            // habitual start time, every suggestion drawn from it. No match simply means the draft
            // opens as a new event, which the user can redirect in one click. The prompt carries the
            // burden instead: it tells the model to copy a listed title character for character.
            var matched = string.IsNullOrWhiteSpace(entry.Activity)
                ? null
                : activities.FirstOrDefault(a =>
                    string.Equals(a.Title.Trim(), entry.Activity.Trim(), StringComparison.OrdinalIgnoreCase));

            // The matched activity's own name comes before the note text: with several entries the
            // note describes all of them, so it is a poor title for any one.
            var title = !string.IsNullOrWhiteSpace(entry.Title) ? entry.Title.Trim()
                : matched?.Title ?? text.Trim();
            if (title.Length > 255) title = title[..255];

            RecommendationService.ActivityStats? habit = null;
            if (matched is not null && !habits.TryGetValue(matched.Id, out habit))
                habits[matched.Id] = habit = await HabitAsync(userId, matched.Id, ctx, ct);

            var (startAt, endAt, isAllDay) = ResolveSchedule(entry, ctx, habit);

            drafts.Add(new CaptureDraftDto(
                title,
                matched?.Id,
                matched?.Title,
                startAt,
                endAt,
                isAllDay,
                entry.Planned,
                entry.DurationMinutes is > 0 and <= 24 * 60 ? entry.DurationMinutes : null,
                (entry.Subtasks ?? [])
                    .Select(s => s.Trim())
                    .Where(s => s.Length is > 0 and <= 255)
                    .Take(20)
                    .ToList()));
        }

        return Result<CaptureResultDto>.Success(new CaptureResultDto(
            await FlagDuplicatesAsync(userId, drafts, ctx, ct), Diagnostics(raw)));
    }

    /// <summary>
    /// A call that ran but produced nothing to put on the calendar. Deliberately a
    /// <em>result</em> rather than an <see cref="ErrorType.Unavailable"/> error, because the two
    /// carry different things: an error carries one sentence, and one sentence is exactly what
    /// cannot distinguish a truncated reply from a looping one from a model that ignored the schema.
    /// The reply itself can - truncated JSON is recognisable on sight - and so can the token counts
    /// beside it, which say whether the output budget was spent. Both are already paid for by the
    /// time this returns, so withholding them buys nothing.
    /// </summary>
    private static Result<CaptureResultDto> Unusable(LlmCompletion raw, string problem) =>
        Result<CaptureResultDto>.Success(new CaptureResultDto([], Diagnostics(raw), problem));

    private static CaptureDiagnosticsDto Diagnostics(LlmCompletion raw) =>
        new(raw.Model, raw.TotalMs, raw.LoadMs, raw.PromptTokens, raw.OutputTokens, raw.Content);

    /// <summary>
    /// Points a draft at the occurrence it would duplicate, when the same activity is already on the
    /// calendar that day.
    /// <para>
    /// A pasted rota covers days that are half logged already - the week's schedule arrives on
    /// Wednesday - and re-adding what is there corrupts the very history the engine reads. The check
    /// is the app's, not the model's: the calendar is a fact the app holds, and asking a model to
    /// cross-reference it would cost prefill for a worse answer. Same activity, same day is the whole
    /// rule; it is deliberately blind to clock times, because a shift moved by an hour is the same
    /// shift re-listed, not a second one.
    /// </para>
    /// <para>
    /// Flagged, never dropped: a draft the user does want is one tick away, and two sessions of the
    /// same activity in a day are legitimate. Skipped occurrences do not count - a skipped thing did
    /// not happen, so re-planning it is exactly what the user is doing.
    /// </para>
    /// </summary>
    private async Task<List<CaptureDraftDto>> FlagDuplicatesAsync(
        Guid userId, List<CaptureDraftDto> drafts, DayContext ctx, CancellationToken ct)
    {
        var activityIds = drafts
            .Where(d => d.ActivityId is not null && d.StartAt is not null)
            .Select(d => d.ActivityId!.Value)
            .Distinct()
            .ToList();

        if (activityIds.Count == 0) return drafts;

        // Whole history per activity: the day window cannot be pushed into SQL (SQLite has no
        // instant-correct DateTimeOffset comparison), and one user's rows for a handful of activities
        // are few enough that bucketing them here is cheaper than the query gymnastics.
        var existing = await db.Occurrences
            .AsNoTracking()
            .Where(o => o.UserId == userId
                && activityIds.Contains(o.ActivityId)
                && o.Status != EventStatus.skipped
                && o.StartAt != null)
            .Select(o => new { o.Id, o.ActivityId, o.StartAt })
            .ToListAsync(ct);

        var byDay = new Dictionary<(Guid Activity, DateOnly Day), Guid>();
        foreach (var o in existing)
            byDay.TryAdd((o.ActivityId, DayMath.DayOf(o.StartAt!.Value, ctx)), o.Id);

        return drafts
            .Select(d => d.ActivityId is { } id && d.StartAt is { } start
                && byDay.TryGetValue((id, DayMath.DayOf(start, ctx)), out var existingId)
                    ? d with { ExistingOccurrenceId = existingId }
                    : d)
            .ToList();
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
    /// <para>
    /// How long a thing takes is the activity's own business, so a start with no length falls back to
    /// the habitual duration whichever half the start came from. A note times what it cares about -
    /// "commute home at five" says nothing about the drive - and the history already knows the rest.
    /// </para>
    /// </summary>
    private static (DateTimeOffset? StartAt, DateTimeOffset? EndAt, bool IsAllDay) ResolveSchedule(
        ModelEntry d, DayContext ctx, RecommendationService.ActivityStats? habit)
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
                return (start, EndAfter(start, d.DurationMinutes ?? habit.DurationMinutes), false);
            }

            // Nothing to go on: a day named without a clock time is a date commitment.
            return (Local(date.ToDateTime(TimeOnly.MinValue), ctx), null, true);
        }

        if (d.AllDay) return (Local(date.ToDateTime(TimeOnly.MinValue), ctx), null, true);

        var startAt = Local(date.ToDateTime(time), ctx);
        return (startAt, EndAfter(startAt, d.DurationMinutes ?? habit?.DurationMinutes), false);
    }

    /// <summary>
    /// Where a span of <paramref name="minutes"/> ends, or null for an open-ended draft. An
    /// implausible length is treated as no length: a wrong end is a block drawn across the day.
    /// </summary>
    private static DateTimeOffset? EndAfter(DateTimeOffset start, int? minutes) =>
        minutes is > 0 and <= 24 * 60 ? start.AddMinutes(minutes.Value) : null;

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
    private sealed record ModelReply(List<ModelEntry>? Entries);

    private sealed record ModelEntry(
        string? Title,
        string? Activity,
        string? Date,
        string? StartTime,
        [property: JsonPropertyName("durationMinutes")] int? DurationMinutes,
        bool AllDay,
        bool Planned,
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
