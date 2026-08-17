using Stryde.Core.Common;
using Stryde.Core.Entities;
using Stryde.Core.Enums;

namespace Stryde.Tests.Unit;

/// <summary>
/// Everything here is about the code around the model. The reply is scripted, so what is under test
/// is the half that has to be right whatever the model says: which activity a name resolves to, what
/// a bare local date and clock time become in the user's timezone, and how a bad reply is contained.
/// </summary>
public class CaptureServiceTests : IDisposable
{
    private readonly TestContext _ctx = new();

    public void Dispose() => _ctx.Dispose();

    private async Task<Guid> CreateUserAsync(string timezone = "UTC")
    {
        var user = new User
        {
            Username = "u" + Guid.NewGuid().ToString("N")[..8],
            PasswordHash = "x",
            Timezone = timezone,
        };
        _ctx.Db.Users.Add(user);
        await _ctx.Db.SaveChangesAsync();
        await _ctx.EnableLlmAsync(user.Id);
        return user.Id;
    }

    private async Task<Activity> AddActivityAsync(Guid userId, string title, ActivityKind kind = ActivityKind.activity)
    {
        var activity = new Activity { UserId = userId, Title = title, Kind = kind };
        _ctx.Db.Activities.Add(activity);
        await _ctx.Db.SaveChangesAsync();
        return activity;
    }

    private static string Reply(
        string title = "Gym", string? activity = null, string? date = null, string? startTime = null,
        int? duration = null, bool allDay = false, string subtasks = "[]") =>
        $$"""
        {
          "title": {{Json(title)}},
          "activity": {{Json(activity)}},
          "date": {{Json(date)}},
          "startTime": {{Json(startTime)}},
          "durationMinutes": {{(duration?.ToString() ?? "null")}},
          "allDay": {{(allDay ? "true" : "false")}},
          "subtasks": {{subtasks}}
        }
        """;

    private static string Json(string? s) => s is null ? "null" : $"\"{s}\"";

    // ── the gate ───────────────────────────────────────────────────────────

    [Fact]
    public async Task ParseAsync_returns_unavailable_when_assistant_is_off()
    {
        var userId = await CreateUserAsync();
        var settings = await _ctx.UserSettingsService.GetOrCreateAsync(userId);
        settings.LlmEnabled = false;
        await _ctx.Db.SaveChangesAsync();

        var result = await _ctx.CaptureService.ParseAsync(userId, "gym tomorrow");

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Unavailable, result.Error!.Type);
        // The gate must come before the call, not after it: a disabled account never waits on a model.
        Assert.Equal(0, _ctx.Llm.Calls);
    }

    [Fact]
    public async Task ParseAsync_rejects_empty_text_without_calling_the_model()
    {
        var userId = await CreateUserAsync();

        var result = await _ctx.CaptureService.ParseAsync(userId, "   ");

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
        Assert.Equal(0, _ctx.Llm.Calls);
    }

    [Fact]
    public async Task ParseAsync_surfaces_an_unreachable_server_as_unavailable()
    {
        var userId = await CreateUserAsync();
        _ctx.Llm.Failure = new Error(ErrorType.Unavailable, "Could not reach the model server.");

        var result = await _ctx.CaptureService.ParseAsync(userId, "gym tomorrow");

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Unavailable, result.Error!.Type);
    }

    [Fact]
    public async Task ParseAsync_contains_a_reply_that_is_not_json()
    {
        var userId = await CreateUserAsync();
        _ctx.Llm.Content = "Sure! Here is your calendar entry:";

        var result = await _ctx.CaptureService.ParseAsync(userId, "gym tomorrow");

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Unavailable, result.Error!.Type);
    }

    // ── activity matching ──────────────────────────────────────────────────

    [Fact]
    public async Task ParseAsync_links_an_exactly_named_activity()
    {
        var userId = await CreateUserAsync();
        var gym = await AddActivityAsync(userId, "Gym session");
        _ctx.Llm.Content = Reply(title: "Gym", activity: "Gym session", date: "2026-08-18", startTime: "07:00");

        var result = await _ctx.CaptureService.ParseAsync(userId, "gym tomorrow at 7");

        Assert.True(result.IsSuccess);
        Assert.Equal(gym.Id, result.Value!.ActivityId);
        Assert.Equal("Gym session", result.Value.ActivityTitle);
    }

    [Fact]
    public async Task ParseAsync_matches_an_activity_ignoring_case_and_space()
    {
        var userId = await CreateUserAsync();
        var gym = await AddActivityAsync(userId, "Gym session");
        _ctx.Llm.Content = Reply(activity: "  gym SESSION ", date: "2026-08-18", startTime: "07:00");

        var result = await _ctx.CaptureService.ParseAsync(userId, "gym tomorrow at 7");

        Assert.Equal(gym.Id, result.Value!.ActivityId);
    }

    [Fact]
    public async Task ParseAsync_does_not_link_on_a_partial_name()
    {
        var userId = await CreateUserAsync();
        await AddActivityAsync(userId, "Run errands");
        // A substring match here would point the occurrence at "Run errands" and quietly corrupt that
        // activity's cadence and habitual start time. No match is the safe answer: it opens as a new
        // event, which the user can redirect.
        _ctx.Llm.Content = Reply(title: "Run", activity: "Run", date: "2026-08-18", startTime: "07:00");

        var result = await _ctx.CaptureService.ParseAsync(userId, "run tomorrow at 7");

        Assert.Null(result.Value!.ActivityId);
        Assert.Equal("Run", result.Value.Title);
    }

    [Fact]
    public async Task ParseAsync_never_links_another_users_activity()
    {
        var userId = await CreateUserAsync();
        var otherId = await CreateUserAsync();
        await AddActivityAsync(otherId, "Gym session");
        _ctx.Llm.Content = Reply(activity: "Gym session", date: "2026-08-18", startTime: "07:00");

        var result = await _ctx.CaptureService.ParseAsync(userId, "gym tomorrow at 7");

        Assert.Null(result.Value!.ActivityId);
    }

    [Fact]
    public async Task ParseAsync_does_not_offer_event_backing_activities()
    {
        var userId = await CreateUserAsync();
        await AddActivityAsync(userId, "Dentist", ActivityKind.@event);

        _ctx.Llm.Content = Reply(activity: "Dentist", date: "2026-08-18", startTime: "07:00");
        var result = await _ctx.CaptureService.ParseAsync(userId, "dentist tomorrow");

        // An event's activity row belongs to one occurrence; it is not a reusable thing to log again.
        Assert.Null(result.Value!.ActivityId);
        Assert.DoesNotContain("Dentist", _ctx.Llm.LastUserPrompt);
    }

    // ── schedule resolution ────────────────────────────────────────────────

    [Fact]
    public async Task ParseAsync_resolves_a_local_time_in_the_users_timezone()
    {
        // +02:00 in August. The model is never told the offset, so this is entirely the service's work.
        var userId = await CreateUserAsync("Europe/Zagreb");
        _ctx.Llm.Content = Reply(date: "2026-08-18", startTime: "07:00", duration: 90);

        var result = await _ctx.CaptureService.ParseAsync(userId, "gym tomorrow at 7 for an hour and a half");

        var start = result.Value!.StartAt!.Value;
        Assert.Equal(new DateTime(2026, 8, 18, 7, 0, 0), start.DateTime);
        Assert.Equal(TimeSpan.FromHours(2), start.Offset);
        Assert.Equal(start.AddMinutes(90), result.Value.EndAt);
        Assert.Equal(90, result.Value.DurationMinutes);
        Assert.False(result.Value.IsAllDay);
    }

    [Fact]
    public async Task ParseAsync_leaves_a_note_with_no_date_floating()
    {
        var userId = await CreateUserAsync();
        _ctx.Llm.Content = Reply(title: "Read");

        var result = await _ctx.CaptureService.ParseAsync(userId, "read a bit at some point");

        // Guessing today here would be a confident wrong answer; floating is a real answer in this app.
        Assert.Null(result.Value!.StartAt);
        Assert.Null(result.Value.EndAt);
        Assert.False(result.Value.IsAllDay);
    }

    [Fact]
    public async Task ParseAsync_treats_a_day_with_no_clock_time_as_date_only()
    {
        var userId = await CreateUserAsync();
        _ctx.Llm.Content = Reply(title: "Move flat", date: "2026-08-20");

        var result = await _ctx.CaptureService.ParseAsync(userId, "moving flat on thursday");

        Assert.True(result.Value!.IsAllDay);
        Assert.Equal(new DateTime(2026, 8, 20, 0, 0, 0), result.Value.StartAt!.Value.DateTime);
        Assert.Null(result.Value.EndAt);
    }

    /// <summary>Marks the activity done on <paramref name="days"/>, each running start → end.</summary>
    private async Task AddHistoryAsync(
        Guid userId, Guid activityId, TimeOnly start, TimeOnly end, params DateOnly[] days)
    {
        foreach (var day in days)
            _ctx.Db.Occurrences.Add(new Occurrence
            {
                UserId = userId,
                ActivityId = activityId,
                Status = EventStatus.done,
                StartAt = new DateTimeOffset(day.ToDateTime(start), TimeSpan.Zero),
                EndAt = new DateTimeOffset(day.ToDateTime(end), TimeSpan.Zero),
            });
        await _ctx.Db.SaveChangesAsync();
    }

    private static DateOnly DaysAgo(int n) => DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-n));

    [Fact]
    public async Task ParseAsync_fills_a_timeless_note_from_the_activitys_habitual_hours()
    {
        var userId = await CreateUserAsync();
        var work = await AddActivityAsync(userId, "Work");
        await AddHistoryAsync(userId, work.Id, new(9, 30), new(17, 0),
            DaysAgo(1), DaysAgo(2), DaysAgo(3), DaysAgo(4));

        _ctx.Llm.Content = Reply(title: "Work", activity: "Work", date: "2026-08-18");
        var result = await _ctx.CaptureService.ParseAsync(userId, "work tomorrow");

        // Months of 09:30-17:00 beat "no time given", so this is a scheduled block, not an all-dayer.
        Assert.False(result.Value!.IsAllDay);
        Assert.Equal(new DateTime(2026, 8, 18, 9, 30, 0), result.Value.StartAt!.Value.DateTime);
        Assert.Equal(new DateTime(2026, 8, 18, 17, 0, 0), result.Value.EndAt!.Value.DateTime);
    }

    [Fact]
    public async Task ParseAsync_prefers_the_habit_over_the_models_all_day_guess()
    {
        var userId = await CreateUserAsync();
        var work = await AddActivityAsync(userId, "Work");
        await AddHistoryAsync(userId, work.Id, new(9, 30), new(17, 0),
            DaysAgo(1), DaysAgo(2), DaysAgo(3), DaysAgo(4));

        // A model reading "work tomorrow" may well call it an all-day thing. One line of text does
        // not outrank the record of what actually happens.
        _ctx.Llm.Content = Reply(title: "Work", activity: "Work", date: "2026-08-18", allDay: true);
        var result = await _ctx.CaptureService.ParseAsync(userId, "work tomorrow");

        Assert.False(result.Value!.IsAllDay);
        Assert.Equal(new DateTime(2026, 8, 18, 9, 30, 0), result.Value.StartAt!.Value.DateTime);
    }

    [Fact]
    public async Task ParseAsync_keeps_an_explicit_time_over_the_habit()
    {
        var userId = await CreateUserAsync();
        var work = await AddActivityAsync(userId, "Work");
        await AddHistoryAsync(userId, work.Id, new(9, 30), new(17, 0),
            DaysAgo(1), DaysAgo(2), DaysAgo(3), DaysAgo(4));

        _ctx.Llm.Content = Reply(title: "Work", activity: "Work", date: "2026-08-18", startTime: "07:00");
        var result = await _ctx.CaptureService.ParseAsync(userId, "work tomorrow, in at 7");

        Assert.Equal(new DateTime(2026, 8, 18, 7, 0, 0), result.Value!.StartAt!.Value.DateTime);
    }

    [Fact]
    public async Task ParseAsync_stays_date_only_when_one_completion_is_all_there_is()
    {
        var userId = await CreateUserAsync();
        var work = await AddActivityAsync(userId, "Work");
        await AddHistoryAsync(userId, work.Id, new(9, 30), new(17, 0), DaysAgo(1));

        _ctx.Llm.Content = Reply(title: "Work", activity: "Work", date: "2026-08-18");
        var result = await _ctx.CaptureService.ParseAsync(userId, "work tomorrow");

        // A habit has to be earned. One session is not a routine, and a confident wrong time is
        // worse than no time - the same bar the recommendation engine sets.
        Assert.True(result.Value!.IsAllDay);
    }

    [Fact]
    public async Task ParseAsync_stays_date_only_when_the_history_is_itself_all_day()
    {
        var userId = await CreateUserAsync();
        var leave = await AddActivityAsync(userId, "Annual leave");
        foreach (var day in new[] { DaysAgo(1), DaysAgo(2), DaysAgo(3) })
            _ctx.Db.Occurrences.Add(new Occurrence
            {
                UserId = userId,
                ActivityId = leave.Id,
                Status = EventStatus.done,
                IsAllDay = true,
                StartAt = new DateTimeOffset(day.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero),
            });
        await _ctx.Db.SaveChangesAsync();

        _ctx.Llm.Content = Reply(title: "Annual leave", activity: "Annual leave", date: "2026-08-18");
        var result = await _ctx.CaptureService.ParseAsync(userId, "annual leave tomorrow");

        // No exception needed for these: an all-day completion is excluded from the start-time
        // clustering, so there is no habitual hour to find and the draft stays date-only.
        Assert.True(result.Value!.IsAllDay);
    }

    [Fact]
    public async Task ParseAsync_does_not_borrow_another_activitys_hours()
    {
        var userId = await CreateUserAsync();
        var work = await AddActivityAsync(userId, "Work");
        await AddHistoryAsync(userId, work.Id, new(9, 30), new(17, 0),
            DaysAgo(1), DaysAgo(2), DaysAgo(3), DaysAgo(4));
        await AddActivityAsync(userId, "Haircut");

        _ctx.Llm.Content = Reply(title: "Haircut", activity: "Haircut", date: "2026-08-18");
        var result = await _ctx.CaptureService.ParseAsync(userId, "haircut tomorrow");

        Assert.True(result.Value!.IsAllDay);
    }

    [Fact]
    public async Task ParseAsync_stays_date_only_for_an_unmatched_note()
    {
        var userId = await CreateUserAsync();
        _ctx.Llm.Content = Reply(title: "Dentist", date: "2026-08-18");

        var result = await _ctx.CaptureService.ParseAsync(userId, "dentist tomorrow");

        // Nothing matched, so there is no history to read - and no query should have been attempted.
        Assert.Null(result.Value!.ActivityId);
        Assert.True(result.Value.IsAllDay);
    }

    [Fact]
    public async Task ParseAsync_ignores_a_nonsense_date()
    {
        var userId = await CreateUserAsync();
        _ctx.Llm.Content = Reply(title: "Gym", date: "next tuesday", startTime: "07:00");

        var result = await _ctx.CaptureService.ParseAsync(userId, "gym next tuesday");

        Assert.Null(result.Value!.StartAt);
    }

    [Fact]
    public async Task ParseAsync_drops_an_out_of_range_duration()
    {
        var userId = await CreateUserAsync();
        _ctx.Llm.Content = Reply(date: "2026-08-18", startTime: "07:00", duration: 100000);

        var result = await _ctx.CaptureService.ParseAsync(userId, "gym tomorrow at 7");

        Assert.Null(result.Value!.DurationMinutes);
        Assert.Null(result.Value.EndAt);
    }

    // ── the rest of the draft ──────────────────────────────────────────────

    [Fact]
    public async Task ParseAsync_keeps_subtasks_in_order()
    {
        var userId = await CreateUserAsync();
        _ctx.Llm.Content = Reply(date: "2026-08-18", startTime: "07:00",
            subtasks: """["Warmup", "Squats", "Deadlifts"]""");

        var result = await _ctx.CaptureService.ParseAsync(userId, "gym tomorrow: warmup, squats, deadlifts");

        Assert.Equal(["Warmup", "Squats", "Deadlifts"], result.Value!.Subtasks);
    }

    [Fact]
    public async Task ParseAsync_falls_back_to_the_note_when_the_model_gives_no_title()
    {
        var userId = await CreateUserAsync();
        _ctx.Llm.Content = Reply(title: "   ");

        var result = await _ctx.CaptureService.ParseAsync(userId, "something odd");

        Assert.Equal("something odd", result.Value!.Title);
    }

    [Fact]
    public async Task ParseAsync_reports_what_the_call_cost()
    {
        var userId = await CreateUserAsync();
        _ctx.Llm.Content = Reply(date: "2026-08-18", startTime: "07:00");

        var result = await _ctx.CaptureService.ParseAsync(userId, "gym tomorrow at 7");

        var d = result.Value!.Diagnostics;
        Assert.Equal("test-model", d.Model);
        Assert.Equal(1234, d.TotalMs);
        Assert.Equal(100, d.PromptTokens);
        Assert.Equal(50, d.OutputTokens);
        Assert.Contains("\"activity\"", d.RawJson);
    }

    [Fact]
    public async Task ParseAsync_gives_the_model_the_current_date_and_the_activity_list()
    {
        var userId = await CreateUserAsync();
        await AddActivityAsync(userId, "Gym session");
        _ctx.Llm.Content = Reply();

        await _ctx.CaptureService.ParseAsync(userId, "gym tomorrow");

        // Relative dates are the model's job, so it has to be told what "today" is.
        Assert.Contains(DateTime.UtcNow.ToString("yyyy-MM-dd"), _ctx.Llm.LastUserPrompt);
        Assert.Contains("Gym session", _ctx.Llm.LastUserPrompt);
        Assert.Contains("gym tomorrow", _ctx.Llm.LastUserPrompt);
    }

    // ── status ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetStatusAsync_reports_whether_the_configured_model_is_pulled()
    {
        var userId = await CreateUserAsync();
        _ctx.Llm.Models = ["other-model:8b"];

        var missing = await _ctx.CaptureService.GetStatusAsync(userId);
        Assert.True(missing.IsSuccess);
        Assert.False(missing.Value!.ModelAvailable);

        // Ollama accepts a bare name for a ":latest" tag, so both spellings have to count.
        _ctx.Llm.Models = ["test-model:latest"];
        var present = await _ctx.CaptureService.GetStatusAsync(userId);
        Assert.True(present.Value!.ModelAvailable);
    }
}
