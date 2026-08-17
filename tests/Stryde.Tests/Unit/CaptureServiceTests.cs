using Stryde.Core.Common;
using Stryde.Core.Dtos;
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

    /// <summary>One entry, wrapped in the reply envelope the schema asks for.</summary>
    private static string Reply(
        string title = "Gym", string? activity = null, string? date = null, string? startTime = null,
        int? duration = null, bool allDay = false, bool planned = false, string subtasks = "[]") =>
        Entries(Entry(title, activity, date, startTime, duration, allDay, planned, subtasks));

    private static string Entries(params string[] entries) =>
        $$"""{ "entries": [{{string.Join(",", entries)}}] }""";

    private static string Entry(
        string title = "Gym", string? activity = null, string? date = null, string? startTime = null,
        int? duration = null, bool allDay = false, bool planned = false, string subtasks = "[]") =>
        $$"""
        {
          "title": {{Json(title)}},
          "activity": {{Json(activity)}},
          "date": {{Json(date)}},
          "startTime": {{Json(startTime)}},
          "durationMinutes": {{(duration?.ToString() ?? "null")}},
          "allDay": {{(allDay ? "true" : "false")}},
          "planned": {{(planned ? "true" : "false")}},
          "subtasks": {{subtasks}}
        }
        """;

    private static string Json(string? s) => s is null ? "null" : $"\"{s}\"";

    /// <summary>
    /// The single-entry case, which most of these tests are about. Asserts the reply produced exactly
    /// one draft, so a test that means "one thing" cannot quietly pass on two.
    /// </summary>
    private async Task<Result<CaptureDraftDto>> ParseOneAsync(Guid userId, string note)
    {
        var result = await _ctx.CaptureService.ParseAsync(userId, note);
        return result.IsSuccess
            ? Result<CaptureDraftDto>.Success(Assert.Single(result.Value!.Drafts))
            : Result<CaptureDraftDto>.Fail(result.Error!);
    }

    // ── the gate ───────────────────────────────────────────────────────────

    [Fact]
    public async Task ParseAsync_returns_unavailable_when_assistant_is_off()
    {
        var userId = await CreateUserAsync();
        var settings = await _ctx.UserSettingsService.GetOrCreateAsync(userId);
        settings.LlmEnabled = false;
        await _ctx.Db.SaveChangesAsync();

        var result = await ParseOneAsync(userId, "gym tomorrow");

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Unavailable, result.Error!.Type);
        // The gate must come before the call, not after it: a disabled account never waits on a model.
        Assert.Equal(0, _ctx.Llm.Calls);
    }

    [Fact]
    public async Task ParseAsync_rejects_empty_text_without_calling_the_model()
    {
        var userId = await CreateUserAsync();

        var result = await ParseOneAsync(userId, "   ");

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Validation, result.Error!.Type);
        Assert.Equal(0, _ctx.Llm.Calls);
    }

    [Fact]
    public async Task ParseAsync_surfaces_an_unreachable_server_as_unavailable()
    {
        var userId = await CreateUserAsync();
        _ctx.Llm.Failure = new Error(ErrorType.Unavailable, "Could not reach the model server.");

        var result = await ParseOneAsync(userId, "gym tomorrow");

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Unavailable, result.Error!.Type);
    }

    [Fact]
    public async Task ParseAsync_contains_a_reply_that_is_not_json()
    {
        var userId = await CreateUserAsync();
        _ctx.Llm.Content = "Sure! Here is your calendar entry:";

        var result = await ParseOneAsync(userId, "gym tomorrow");

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

        var result = await ParseOneAsync(userId, "gym tomorrow at 7");

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

        var result = await ParseOneAsync(userId, "gym tomorrow at 7");

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

        var result = await ParseOneAsync(userId, "run tomorrow at 7");

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

        var result = await ParseOneAsync(userId, "gym tomorrow at 7");

        Assert.Null(result.Value!.ActivityId);
    }

    [Fact]
    public async Task ParseAsync_does_not_offer_event_backing_activities()
    {
        var userId = await CreateUserAsync();
        await AddActivityAsync(userId, "Dentist", ActivityKind.@event);

        _ctx.Llm.Content = Reply(activity: "Dentist", date: "2026-08-18", startTime: "07:00");
        var result = await ParseOneAsync(userId, "dentist tomorrow");

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

        var result = await ParseOneAsync(userId, "gym tomorrow at 7 for an hour and a half");

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

        var result = await ParseOneAsync(userId, "read a bit at some point");

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

        var result = await ParseOneAsync(userId, "moving flat on thursday");

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
        var result = await ParseOneAsync(userId, "work tomorrow");

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
        var result = await ParseOneAsync(userId, "work tomorrow");

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
        var result = await ParseOneAsync(userId, "work tomorrow, in at 7");

        Assert.Equal(new DateTime(2026, 8, 18, 7, 0, 0), result.Value!.StartAt!.Value.DateTime);
    }

    [Fact]
    public async Task ParseAsync_carries_the_planned_flag_through()
    {
        var userId = await CreateUserAsync();
        _ctx.Llm.Content = Reply(title: "Workout", date: "2026-08-17", startTime: "21:00", planned: true);

        var result = await ParseOneAsync(userId, "add a planned workout for 21:00 today");

        // Planned is the note's own framing and nothing else can supply it: unlike the hours, the
        // app's data cannot say whether a thing is committed to.
        Assert.True(result.Value!.IsPlanned);
        Assert.Equal(new DateTime(2026, 8, 17, 21, 0, 0), result.Value.StartAt!.Value.DateTime);
    }

    [Fact]
    public async Task ParseAsync_leaves_an_ordinary_entry_unplanned()
    {
        var userId = await CreateUserAsync();
        _ctx.Llm.Content = Reply(title: "Dentist", date: "2026-08-18", startTime: "09:00");

        var result = await ParseOneAsync(userId, "dentist tomorrow at 9");

        Assert.False(result.Value!.IsPlanned);
    }

    [Fact]
    public async Task ParseAsync_fills_a_timed_note_from_the_activitys_habitual_duration()
    {
        var userId = await CreateUserAsync();
        var commute = await AddActivityAsync(userId, "Work -> Home commute");
        // Scattered starts, consistent length: the evening commute leaves whenever the day ends but
        // always takes an hour, so there is a habitual duration to read and no habitual start.
        await AddHistoryAsync(userId, commute.Id, new(16, 30), new(17, 30), DaysAgo(1));
        await AddHistoryAsync(userId, commute.Id, new(17, 5), new(18, 5), DaysAgo(2));
        await AddHistoryAsync(userId, commute.Id, new(17, 40), new(18, 40), DaysAgo(3));
        await AddHistoryAsync(userId, commute.Id, new(18, 20), new(19, 20), DaysAgo(4));

        _ctx.Llm.Content = Reply(
            title: "Work -> Home commute", activity: "Work -> Home commute",
            date: "2026-08-18", startTime: "17:00");
        var result = await ParseOneAsync(userId, "work 9:30 to 17:00 tomorrow, with the commutes");

        // The note times the start and says nothing about the drive; how long it takes is the
        // activity's own business.
        Assert.Equal(new DateTime(2026, 8, 18, 17, 0, 0), result.Value!.StartAt!.Value.DateTime);
        Assert.Equal(new DateTime(2026, 8, 18, 18, 0, 0), result.Value.EndAt!.Value.DateTime);
        Assert.False(result.Value.IsAllDay);
    }

    [Fact]
    public async Task ParseAsync_keeps_an_explicit_duration_over_the_habitual_one()
    {
        var userId = await CreateUserAsync();
        var work = await AddActivityAsync(userId, "Work");
        await AddHistoryAsync(userId, work.Id, new(9, 30), new(17, 0),
            DaysAgo(1), DaysAgo(2), DaysAgo(3), DaysAgo(4));

        // No start time given, so the habit places it - but a stated length is a fact about this
        // occurrence, not a guess, and outranks the usual 7.5 hours.
        _ctx.Llm.Content = Reply(title: "Work", activity: "Work", date: "2026-08-18", duration: 180);
        var result = await ParseOneAsync(userId, "work a half day tomorrow, 3 hours");

        Assert.Equal(new DateTime(2026, 8, 18, 9, 30, 0), result.Value!.StartAt!.Value.DateTime);
        Assert.Equal(new DateTime(2026, 8, 18, 12, 30, 0), result.Value.EndAt!.Value.DateTime);
    }

    [Fact]
    public async Task ParseAsync_stays_date_only_when_one_completion_is_all_there_is()
    {
        var userId = await CreateUserAsync();
        var work = await AddActivityAsync(userId, "Work");
        await AddHistoryAsync(userId, work.Id, new(9, 30), new(17, 0), DaysAgo(1));

        _ctx.Llm.Content = Reply(title: "Work", activity: "Work", date: "2026-08-18");
        var result = await ParseOneAsync(userId, "work tomorrow");

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
        var result = await ParseOneAsync(userId, "annual leave tomorrow");

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
        var result = await ParseOneAsync(userId, "haircut tomorrow");

        Assert.True(result.Value!.IsAllDay);
    }

    [Fact]
    public async Task ParseAsync_stays_date_only_for_an_unmatched_note()
    {
        var userId = await CreateUserAsync();
        _ctx.Llm.Content = Reply(title: "Dentist", date: "2026-08-18");

        var result = await ParseOneAsync(userId, "dentist tomorrow");

        // Nothing matched, so there is no history to read - and no query should have been attempted.
        Assert.Null(result.Value!.ActivityId);
        Assert.True(result.Value.IsAllDay);
    }

    [Fact]
    public async Task ParseAsync_ignores_a_nonsense_date()
    {
        var userId = await CreateUserAsync();
        _ctx.Llm.Content = Reply(title: "Gym", date: "next tuesday", startTime: "07:00");

        var result = await ParseOneAsync(userId, "gym next tuesday");

        Assert.Null(result.Value!.StartAt);
    }

    [Fact]
    public async Task ParseAsync_drops_an_out_of_range_duration()
    {
        var userId = await CreateUserAsync();
        _ctx.Llm.Content = Reply(date: "2026-08-18", startTime: "07:00", duration: 100000);

        var result = await ParseOneAsync(userId, "gym tomorrow at 7");

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

        var result = await ParseOneAsync(userId, "gym tomorrow: warmup, squats, deadlifts");

        Assert.Equal(["Warmup", "Squats", "Deadlifts"], result.Value!.Subtasks);
    }

    [Fact]
    public async Task ParseAsync_falls_back_to_the_note_when_the_model_gives_no_title()
    {
        var userId = await CreateUserAsync();
        _ctx.Llm.Content = Reply(title: "   ");

        var result = await ParseOneAsync(userId, "something odd");

        Assert.Equal("something odd", result.Value!.Title);
    }

    [Fact]
    public async Task ParseAsync_reports_what_the_call_cost()
    {
        var userId = await CreateUserAsync();
        _ctx.Llm.Content = Reply(date: "2026-08-18", startTime: "07:00");

        var result = await _ctx.CaptureService.ParseAsync(userId, "gym tomorrow at 7");

        // One call, one cost, however many drafts came out of it.
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

        await ParseOneAsync(userId, "gym tomorrow");

        // Relative dates are the model's job, so it has to be told what "today" is.
        Assert.Contains(DateTime.UtcNow.ToString("yyyy-MM-dd"), _ctx.Llm.LastUserPrompt);
        Assert.Contains("Gym session", _ctx.Llm.LastUserPrompt);
        Assert.Contains("gym tomorrow", _ctx.Llm.LastUserPrompt);
    }

    // ── several entries ────────────────────────────────────────────────────

    [Fact]
    public async Task ParseAsync_returns_one_draft_per_entry()
    {
        var userId = await CreateUserAsync();
        _ctx.Llm.Content = Entries(
            Entry(title: "Commute in", date: "2026-08-18", startTime: "08:00", duration: 40),
            Entry(title: "Work", date: "2026-08-18", startTime: "09:00", duration: 480),
            Entry(title: "Commute home", date: "2026-08-18", startTime: "17:30", duration: 40));

        var result = await _ctx.CaptureService.ParseAsync(userId, "work tomorrow plus both commutes");

        Assert.Equal(3, result.Value!.Drafts.Count);
        // Order is the model's, which is the order the note listed them in.
        Assert.Equal(["Commute in", "Work", "Commute home"], result.Value.Drafts.Select(d => d.Title));
        Assert.Equal(new DateTime(2026, 8, 18, 17, 30, 0), result.Value.Drafts[2].StartAt!.Value.DateTime);
    }

    [Fact]
    public async Task ParseAsync_reads_one_activitys_history_once_for_every_entry_naming_it()
    {
        var userId = await CreateUserAsync();
        var work = await AddActivityAsync(userId, "Work");
        await AddHistoryAsync(userId, work.Id, new(9, 30), new(17, 0),
            DaysAgo(1), DaysAgo(2), DaysAgo(3), DaysAgo(4));

        // A pasted week: same activity, no clock times. Every day gets the same habitual hours.
        _ctx.Llm.Content = Entries(
            Entry(title: "Work", activity: "Work", date: "2026-08-18"),
            Entry(title: "Work", activity: "Work", date: "2026-08-19"),
            Entry(title: "Work", activity: "Work", date: "2026-08-20"));

        var result = await _ctx.CaptureService.ParseAsync(userId, "work mon to wed");

        Assert.Equal(3, result.Value!.Drafts.Count);
        Assert.All(result.Value.Drafts, d =>
        {
            Assert.Equal(work.Id, d.ActivityId);
            Assert.False(d.IsAllDay);
            Assert.Equal(new TimeSpan(9, 30, 0), d.StartAt!.Value.TimeOfDay);
        });
        Assert.Equal(
            [new DateTime(2026, 8, 18), new DateTime(2026, 8, 19), new DateTime(2026, 8, 20)],
            result.Value.Drafts.Select(d => d.StartAt!.Value.Date));
    }

    [Fact]
    public async Task ParseAsync_titles_an_untitled_entry_from_the_activity_it_matched()
    {
        var userId = await CreateUserAsync();
        await AddActivityAsync(userId, "Work");
        _ctx.Llm.Content = Entries(
            Entry(title: "", activity: "Work", date: "2026-08-18", startTime: "09:00"),
            Entry(title: "Gym", date: "2026-08-18", startTime: "18:00"));

        var result = await _ctx.CaptureService.ParseAsync(userId, "work then gym tomorrow");

        // With several entries the note describes all of them, so it is a poor title for any one.
        Assert.Equal("Work", result.Value!.Drafts[0].Title);
    }

    [Fact]
    public async Task ParseAsync_caps_how_many_entries_one_note_can_produce()
    {
        var userId = await CreateUserAsync();
        _ctx.Llm.Content = Entries(Enumerable.Range(0, 50)
            .Select(_ => Entry(date: "2026-08-18", startTime: "07:00"))
            .ToArray());

        var result = await _ctx.CaptureService.ParseAsync(userId, "gym");

        // A model that has started repeating itself must not turn one note into fifty rows to review.
        Assert.Equal(30, result.Value!.Drafts.Count);
    }

    [Fact]
    public async Task ParseAsync_reports_an_empty_entry_list_rather_than_an_empty_answer()
    {
        var userId = await CreateUserAsync();
        _ctx.Llm.Content = Entries();

        var result = await _ctx.CaptureService.ParseAsync(userId, "hmm");

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorType.Unavailable, result.Error!.Type);
    }

    // ── what the calendar already has ──────────────────────────────────────

    /// <summary>One occurrence of <paramref name="activityId"/>, 08:00 on the given day.</summary>
    private async Task<Occurrence> AddOccurrenceAsync(
        Guid userId, Guid activityId, DateOnly day, EventStatus status = EventStatus.pending)
    {
        var occurrence = new Occurrence
        {
            UserId = userId,
            ActivityId = activityId,
            Status = status,
            StartAt = new DateTimeOffset(day.ToDateTime(new TimeOnly(8, 0)), TimeSpan.Zero),
            EndAt = new DateTimeOffset(day.ToDateTime(new TimeOnly(16, 0)), TimeSpan.Zero),
        };
        _ctx.Db.Occurrences.Add(occurrence);
        await _ctx.Db.SaveChangesAsync();
        return occurrence;
    }

    [Fact]
    public async Task ParseAsync_flags_a_draft_the_calendar_already_has()
    {
        var userId = await CreateUserAsync();
        var work = await AddActivityAsync(userId, "Work");
        var already = await AddOccurrenceAsync(userId, work.Id, new DateOnly(2026, 8, 18));

        // A different clock time on purpose: a shift re-listed an hour out is the same shift, not a
        // second one.
        _ctx.Llm.Content = Reply(title: "Work", activity: "Work", date: "2026-08-18", startTime: "09:30");
        var result = await ParseOneAsync(userId, "work tomorrow 9:30-17:00");

        Assert.Equal(already.Id, result.Value!.ExistingOccurrenceId);
    }

    [Fact]
    public async Task ParseAsync_flags_only_the_days_the_calendar_already_has()
    {
        var userId = await CreateUserAsync();
        var work = await AddActivityAsync(userId, "Work");
        var already = await AddOccurrenceAsync(userId, work.Id, new DateOnly(2026, 8, 19));

        // The pasted-rota case: a week's schedule that arrives once part of it is logged.
        _ctx.Llm.Content = Entries(
            Entry(title: "Work", activity: "Work", date: "2026-08-18", startTime: "08:00"),
            Entry(title: "Work", activity: "Work", date: "2026-08-19", startTime: "09:30"),
            Entry(title: "Work", activity: "Work", date: "2026-08-20", startTime: "09:30"));

        var result = await _ctx.CaptureService.ParseAsync(userId, "work mon to wed");

        Assert.Equal(
            [null, already.Id, null],
            result.Value!.Drafts.Select(d => d.ExistingOccurrenceId));
    }

    [Fact]
    public async Task ParseAsync_does_not_flag_a_different_activity_on_the_same_day()
    {
        var userId = await CreateUserAsync();
        var work = await AddActivityAsync(userId, "Work");
        await AddActivityAsync(userId, "Work from home");
        await AddOccurrenceAsync(userId, work.Id, new DateOnly(2026, 8, 18));

        _ctx.Llm.Content = Reply(
            title: "Work from home", activity: "Work from home", date: "2026-08-18", startTime: "08:00");
        var result = await ParseOneAsync(userId, "work from home tomorrow 8-16");

        Assert.Null(result.Value!.ExistingOccurrenceId);
    }

    [Fact]
    public async Task ParseAsync_does_not_flag_against_a_skipped_occurrence()
    {
        var userId = await CreateUserAsync();
        var work = await AddActivityAsync(userId, "Work");
        await AddOccurrenceAsync(userId, work.Id, new DateOnly(2026, 8, 18), EventStatus.skipped);

        _ctx.Llm.Content = Reply(title: "Work", activity: "Work", date: "2026-08-18", startTime: "09:30");
        var result = await ParseOneAsync(userId, "work tomorrow");

        // A skipped thing did not happen, so re-planning it is the point, not a duplicate.
        Assert.Null(result.Value!.ExistingOccurrenceId);
    }

    [Fact]
    public async Task ParseAsync_does_not_flag_another_users_occurrence()
    {
        var userId = await CreateUserAsync();
        var otherId = await CreateUserAsync();
        var work = await AddActivityAsync(userId, "Work");
        await AddOccurrenceAsync(otherId, work.Id, new DateOnly(2026, 8, 18));

        _ctx.Llm.Content = Reply(title: "Work", activity: "Work", date: "2026-08-18", startTime: "09:30");
        var result = await ParseOneAsync(userId, "work tomorrow");

        Assert.Null(result.Value!.ExistingOccurrenceId);
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
