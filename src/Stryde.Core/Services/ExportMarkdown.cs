using System.Globalization;
using System.Text;
using Stryde.Core.Common;
using Stryde.Core.Entities;
using Stryde.Core.Enums;

namespace Stryde.Core.Services;

/// <summary>
/// Everything one user has, rendered as a single Markdown document.
/// <para>
/// The audience is a person (or an LLM) being shown how the app is used, not an importer: there is no
/// read path back, so ids are dropped and every reference is by name, every stored number is spelled
/// out in the words the UI uses for it, and instants are printed in the user's own timezone. What a
/// field means is written down next to it - a reader has never seen this app.
/// </para>
/// </summary>
internal sealed class ExportMarkdown(
    DayContext ctx,
    User user,
    UserSettings settings,
    List<ActivityType> types,
    List<Category> categories,
    List<Goal> goals,
    List<State> states,
    List<Activity> activities,
    List<Occurrence> occurrences,
    DateTimeOffset exportedAt)
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    private readonly StringBuilder sb = new();

    /// <summary>Every state value by id, with the state it belongs to, for naming a link out of context.</summary>
    private readonly Dictionary<Guid, (State State, StateValue Value)> valueIndex =
        states.SelectMany(s => s.Values.Select(v => (State: s, Value: v)))
              .ToDictionary(p => p.Value.Id, p => p);

    private readonly Dictionary<Guid, List<Occurrence>> occurrencesByActivity =
        occurrences.GroupBy(o => o.ActivityId).ToDictionary(g => g.Key, g => g.ToList());

    /// <summary>
    /// Activities the user authored. Event-kind rows are backing rows owned 1:1 by a one-off
    /// occurrence, so they are history, not vocabulary, and would bury the real list.
    /// </summary>
    private readonly List<Activity> namedActivities =
        activities.Where(a => a.Kind == ActivityKind.activity)
                  .OrderBy(a => a.Title, StringComparer.CurrentCultureIgnoreCase)
                  .ToList();

    public string Render()
    {
        Header();
        Glossary();
        AtAGlance();
        Settings();
        Types();
        States();
        Categories();
        Goals();
        Activities();
        History();
        return sb.ToString();
    }

    // ── sections ───────────────────────────────────────────────────────────────

    private void Header()
    {
        Line($"# Stryde export: {user.Username}");
        Line();
        Line($"Exported {Stamp(exportedAt)} ({user.Timezone}).");
        Line();
        Line("Stryde is a personal operations app: it holds the things I do, the goals they serve, and");
        Line("the plan for a given day, and it suggests what to schedule next. This file is the whole");
        Line("account written out to be read. It is not a backup: internal ids are gone, everything");
        Line("refers to everything else by name, and there is no way to load it back in.");
        Line();
        Line($"All dates and times are local to {user.Timezone} on a 24h clock.");
        Line();
    }

    private void Glossary()
    {
        Heading2("What the words mean");
        Bullet("**Activity** - a thing I do, defined once and done many times: \"Run\", \"Read\".");
        Bullet("**Occurrence** - one instance of an activity, planned or already done. The History section at the end is every one of them.");
        Bullet("**Event** - a one-off. It has a throwaway activity behind it that is never reused, so events appear only in the History, never in the activity list.");
        Bullet("**Category** - the colour-coded bucket an activity belongs to.");
        Bullet("**Goal** - something I am working towards; **checkpoints** are its steps.");
        Bullet("**Activity type** - a scheduling preset shared by many activities: what part of the day they fit in, how big a free block they need, how often they should come round.");
        Bullet("**State** - a dimension of context I defined (\"Location\", \"Tired\"). Its value is never stored: it is derived from the schedule, because doing an activity can set it for a while. Activities can also require certain values before the app will suggest them.");
        Bullet("**Muted** - an activity excluded from suggestions. It still exists and can still be scheduled by hand.");
        Line();
        Line("The app's suggestions are computed fresh every time and never stored, so nothing in this");
        Line("file is a suggestion: it is all what I set up, planned, or actually did.");
        Line();
    }

    private void AtAGlance()
    {
        var done = occurrences.Count(o => o.Status == EventStatus.done);
        var skipped = occurrences.Count(o => o.Status == EventStatus.skipped);
        var pending = occurrences.Count(o => o.Status == EventStatus.pending);
        var dated = occurrences.Where(o => o.StartAt.HasValue).Select(o => o.StartAt!.Value).ToList();
        var muted = namedActivities.Count(a => a.ExcludeFromRecommendations);
        var events = activities.Count - namedActivities.Count;

        Heading2("At a glance");
        TableHeader("What", "How much");
        Row("Activities", $"{namedActivities.Count}" + (muted > 0 ? $" ({muted} muted from suggestions)" : ""));
        Row("One-off events", events.ToString(Inv));
        Row("Occurrences", $"{occurrences.Count}: {done} done, {skipped} skipped, {pending} pending");
        Row("History spans", dated.Count > 0 ? $"{Date(dated.Min())} to {Date(dated.Max())}" : "nothing scheduled yet");
        Row("Goals", Counted(goals.Select(g => g.Status.ToString())));
        Row("Categories", categories.Count.ToString(Inv));
        Row("Activity types", types.Count.ToString(Inv));
        Row("States", states.Count.ToString(Inv));
        Line();

        var months = occurrences
            .Where(o => o.StartAt.HasValue)
            .GroupBy(o => Local(o.StartAt!.Value).ToString("yyyy-MM", Inv))
            .OrderByDescending(g => g.Key)
            .Take(12)
            .ToList();

        if (months.Count > 0)
        {
            Line("Occurrences per month, most recent first:");
            Line();
            TableHeader("Month", "Occurrences", "Done", "Skipped", "Pending");
            foreach (var m in months)
                Row(m.Key,
                    m.Count().ToString(Inv),
                    m.Count(o => o.Status == EventStatus.done).ToString(Inv),
                    m.Count(o => o.Status == EventStatus.skipped).ToString(Inv),
                    m.Count(o => o.Status == EventStatus.pending).ToString(Inv));
            Line();
        }
    }

    private void Settings()
    {
        Heading2("Settings");
        Bullet($"Timezone: {user.Timezone}");
        Bullet($"Day boundary: {settings.DayBoundaryTime.ToString("HH:mm", Inv)} - a day runs from here to the same time next day, so anything earlier counts as the previous day");
        Bullet($"Max focus goals at once: {settings.MaxFocusGoals}");
        Bullet($"Suggestions drawn on the calendar per day: {settings.MaxCalendarSuggestions}");
        Bullet(settings.UnaccountedRequirements.Count > 0
            ? "Unaccounted time is only measured while "
              + DescribeRequirements(settings.UnaccountedRequirements.Select(r => r.StateValueId))
              + " - hours outside that are left out of the stats entirely rather than counted as free time"
            : "Unaccounted time is measured over the whole day");
        Line();
    }

    private void Types()
    {
        Heading2("Activity types");
        if (types.Count == 0)
        {
            Line("None defined. Every activity is unconstrained: the app may suggest it anywhere the day");
            Line("has room, as often as it likes.");
            Line();
            return;
        }

        Line("A type is a set of scheduling rules the suggestion engine reads. Every number below is one I");
        Line("set myself.");
        Line();

        foreach (var t in types.OrderBy(t => t.CreatedAt))
        {
            Heading3(t.Name);
            Bullet($"When: between {t.WindowStart.ToString("HH:mm", Inv)} and {t.WindowEnd.ToString("HH:mm", Inv)} " +
                   "(a preference for the start, a hard limit for the end)");
            Bullet($"Free block needed: {(t.MinBlockMinutes > 0 ? $"{t.MinBlockMinutes} minutes" : "no minimum")}");
            Bullet($"Per day: {(t.MaxPerDay > 0 ? $"at most {t.MaxPerDay}" : "no cap")}");
            Bullet($"Rhythm: {Cadence(t.CadencePriorDays)}, assumed until my own history says otherwise");
            Bullet($"Cooldown: {Cooldown(t.MinDueFraction)}");
            if (t.Icon is not null) Bullet($"Icon: {t.Icon}");
            Bullet($"Created {Date(t.CreatedAt)}");

            var users = namedActivities.Where(a => a.ActivityTypeId == t.Id).ToList();
            Bullet(users.Count > 0
                ? $"Used by {Plural(users.Count, "activity")}: {string.Join(", ", users.Select(a => a.Title))}"
                : "Not used by any activity.");
            Line();
        }

        var untyped = namedActivities.Where(a => a.ActivityTypeId is null).ToList();
        Heading3("No type");
        Bullet("No constraints at all: no time window, no free-block minimum, no daily cap and no " +
               $"cooldown. Placed wherever the day has room, assumed {Cadence(ActivityProfiles.DefaultCadenceDays)}.");
        Bullet(untyped.Count > 0
            ? $"{Plural(untyped.Count, "activity")}: {string.Join(", ", untyped.Select(a => a.Title))}"
            : "No activity is without a type.");
        Line();
    }

    private void States()
    {
        Heading2("States");
        if (states.Count == 0)
        {
            Line("None defined, so nothing gates the app's suggestions.");
            Line();
            return;
        }

        Line("A state's value at any moment is worked out from the schedule rather than stored: the default");
        Line("holds until an activity sets something else, and that setting expires back to the default after");
        Line("the time given below. Because it is derived, moving an occurrence moves the state with it, and");
        Line("the app can answer for a future moment as readily as a past one.");
        Line();

        foreach (var s in states.OrderBy(s => s.CreatedAt))
        {
            Heading3(s.Name);
            var values = s.Values.OrderBy(v => v.CreatedAt).ToList();
            Bullet("Values: " + (values.Count > 0
                ? string.Join(", ", values.Select(v => v.IsDefault ? $"**{v.Name}** (default)" : v.Name))
                : "none yet"));

            var setters = namedActivities
                .SelectMany(a => a.StateEffects.Where(e => e.StateId == s.Id).Select(e => (Activity: a, Effect: e)))
                .OrderBy(p => p.Activity.Title, StringComparer.CurrentCultureIgnoreCase)
                .ToList();
            if (setters.Count > 0)
            {
                Bullet("Set by:");
                foreach (var (activity, effect) in setters)
                    Bullet($"{activity.Title} sets it to {ValueName(effect.StateValueId)}, {Holds(effect)}", 1);
            }

            var requirers = namedActivities
                .Where(a => a.StateRequirements.Any(r => valueIndex.TryGetValue(r.StateValueId, out var p) && p.State.Id == s.Id))
                .OrderBy(a => a.Title, StringComparer.CurrentCultureIgnoreCase)
                .ToList();
            if (requirers.Count > 0)
            {
                Bullet("Required by:");
                foreach (var a in requirers)
                {
                    var allowed = s.Values.Where(v => a.StateRequirements.Any(r => r.StateValueId == v.Id)).Select(v => v.Name);
                    Bullet($"{a.Title}, only suggested while this is {string.Join(" or ", allowed)}", 1);
                }
            }
            Line();
        }
    }

    private void Categories()
    {
        Heading2("Categories");
        if (categories.Count == 0)
        {
            Line("None defined.");
            Line();
            return;
        }

        TableHeader("Category", "Colour", "Icon", "Activities", "Occurrences", "Created");
        foreach (var c in categories.OrderBy(c => c.CreatedAt))
        {
            var acts = namedActivities.Count(a => a.CategoryId == c.Id);
            var occs = occurrences.Count(o => o.Activity.CategoryId == c.Id);
            Row(Cell(c.Name), c.Color, c.Icon ?? "-", acts.ToString(Inv), occs.ToString(Inv), Date(c.CreatedAt));
        }
        var uncategorised = namedActivities.Count(a => a.CategoryId is null);
        Row("(no category)", "-", "-", uncategorised.ToString(Inv), occurrences.Count(o => o.Activity.CategoryId is null).ToString(Inv), "-");
        Line();
    }

    private void Goals()
    {
        Heading2("Goals");
        if (goals.Count == 0)
        {
            Line("None yet.");
            Line();
            return;
        }

        Line("Status is one of focus (actively working on it), active, bench (parked), or closed. A");
        Line("milestone goal is finished once; an ongoing one is a standing commitment with no end.");
        Line();

        foreach (var g in goals.OrderBy(g => g.CreatedAt))
        {
            Heading3(g.Title);
            Line($"{g.Kind}, {g.Status}, created {Date(g.CreatedAt)}");
            Line();
            if (!string.IsNullOrWhiteSpace(g.Description))
            {
                Line(Quote(g.Description!));
                Line();
            }
            if (!string.IsNullOrWhiteSpace(g.Notes))
            {
                Line("Notes:");
                Line();
                Line(Quote(g.Notes!));
                Line();
            }

            var checkpoints = g.Checkpoints.OrderBy(c => c.CreatedAt).ToList();
            if (checkpoints.Count > 0)
            {
                Line("Checkpoints, in the order I added them (size is how big a step it is):");
                Line();
                foreach (var c in checkpoints)
                {
                    var box = c.Status == CheckpointStatus.reached ? "[x]" : "[ ]";
                    var target = c.TargetDate.HasValue ? $", target {Date(c.TargetDate.Value)}" : "";
                    Bullet($"{box} {c.Title} - {c.Size}{target}");
                }
                Line();
            }

            var served = namedActivities.Where(a => a.GoalId == g.Id).ToList();
            if (served.Count > 0)
            {
                Line("Activities serving it: " + string.Join(", ", served.Select(a =>
                    $"{a.Title} ({Occurrences(a).Count(o => o.Status == EventStatus.done)} done)")));
                Line();
            }
        }
    }

    private void Activities()
    {
        Heading2("Activities");
        Line("Grouped by category. One-off events are left out: each is a single entry in the History with a");
        Line("throwaway activity behind it, never something I repeat.");
        Line();

        var groups = categories
            .OrderBy(c => c.CreatedAt)
            .Select(c => (Name: c.Name, Items: namedActivities.Where(a => a.CategoryId == c.Id).ToList()))
            .Append((Name: "No category", Items: namedActivities.Where(a => a.CategoryId is null).ToList()))
            .Where(g => g.Items.Count > 0);

        foreach (var (name, items) in groups)
        {
            Heading3(name);
            foreach (var a in items) ActivityEntry(a);
        }
    }

    private void ActivityEntry(Activity a)
    {
        Line($"#### {a.Title}");
        Line();

        var facts = new List<string> { $"Type: {a.Type?.Name ?? "none"}" };
        if (a.Goal is not null) facts.Add($"Goal: {a.Goal.Title}");
        if (a.ExcludeFromRecommendations) facts.Add("**muted** (never suggested)");
        facts.Add($"created {Date(a.CreatedAt)}");
        Bullet(string.Join(" - ", facts));

        if (a.Subtasks.Count > 0)
            Bullet("Checklist every occurrence starts with: " +
                   string.Join(", ", a.Subtasks.OrderBy(s => s.CreatedAt).Select(s => s.Title)));

        foreach (var e in a.StateEffects.OrderBy(e => StateNameOf(e.StateValueId)))
            Bullet($"Doing it sets {ValueName(e.StateValueId)}, {Holds(e)}");

        if (a.StateRequirements.Count > 0)
            Bullet($"Only suggested when {DescribeRequirements(a.StateRequirements.Select(r => r.StateValueId))}");

        var stats = Stats(a);
        Bullet(stats);
        Line();
    }

    private void History()
    {
        Heading2("History");
        Line("Every occurrence, newest day first. A line reads: time, what it was, status, then whatever else");
        Line("was set on it. \"planned\" means the time is flexible rather than committed; \"all day\" means a date");
        Line("with no time. \"logged\" appears only when I created the entry on a different day than it happened.");
        Line();

        var dated = occurrences
            .Where(o => o.StartAt.HasValue)
            .GroupBy(o => DayMath.DayOf(o.StartAt!.Value, ctx))
            .OrderByDescending(g => g.Key);

        foreach (var day in dated)
        {
            Heading3($"{day.Key:yyyy-MM-dd}, {day.Key.DayOfWeek}");
            foreach (var o in day.OrderBy(o => o.IsAllDay ? 0 : 1).ThenBy(o => o.StartAt))
                OccurrenceEntry(o);
            Line();
        }

        var floating = occurrences.Where(o => !o.StartAt.HasValue).OrderBy(o => o.CreatedAt).ToList();
        if (floating.Count > 0)
        {
            Heading3("No date");
            Line("Things I want to do with no day attached yet.");
            Line();
            foreach (var o in floating) OccurrenceEntry(o);
            Line();
        }
    }

    private void OccurrenceEntry(Occurrence o)
    {
        var title = o.Title ?? o.Activity.Title;
        var parts = new List<string> { $"**{When(o)}** {title}", o.Status.ToString() };

        if (o.Activity.Kind == ActivityKind.@event) parts.Add("one-off event");
        if (o.Activity.Category is not null) parts.Add(o.Activity.Category.Name);
        if (o.Activity.Goal is not null) parts.Add($"goal: {o.Activity.Goal.Title}");
        if (o.Title is not null && o.Title != o.Activity.Title) parts.Add($"activity: {o.Activity.Title}");
        if (o.IsPlanned) parts.Add("planned, so the time is flexible");
        if (o.DurationMinutes.HasValue) parts.Add($"{o.DurationMinutes} min estimated");
        if (o.WindowStart.HasValue || o.WindowEnd.HasValue || o.WindowDurationMinutes.HasValue)
            parts.Add($"legacy window {(o.WindowStart.HasValue ? Stamp(o.WindowStart.Value) : "?")} to " +
                      $"{(o.WindowEnd.HasValue ? Stamp(o.WindowEnd.Value) : "?")}" +
                      (o.WindowDurationMinutes.HasValue ? $" for {o.WindowDurationMinutes} min" : ""));

        // Only worth printing when it disagrees with the occurrence's own day: that is the case where it
        // says something (planned ahead, or written up after the fact) rather than restating the heading.
        var loggedDay = DayMath.DayOf(o.CreatedAt, ctx);
        if (!o.StartAt.HasValue || loggedDay != DayMath.DayOf(o.StartAt.Value, ctx))
            parts.Add($"logged {Stamp(o.CreatedAt)}");

        Bullet(string.Join(" - ", parts));
        foreach (var s in o.Subtasks.OrderBy(s => s.CreatedAt))
            Bullet($"{(s.IsDone ? "[x]" : "[ ]")} {s.Title}", 1);
    }

    // ── phrasing ───────────────────────────────────────────────────────────────

    private static string Cadence(double priorDays) =>
        priorDays == 1 ? "daily" : $"about every {(priorDays % 1 == 0 ? priorDays.ToString("0", Inv) : priorDays.ToString("0.#", Inv))} days";

    private static string Cooldown(double minDueFraction) => minDueFraction switch
    {
        <= 0 => "none, it can come round as soon as it is due",
        0.5 => "not offered again until halfway to due",
        _ => $"not offered again until {Math.Round(minDueFraction * 100)}% of the way to due",
    };

    /// <summary>How long an effect holds, in the words the activity editor uses for it.</summary>
    private string Holds(ActivityStateEffect e)
    {
        if (e.DurationMinutes is int minutes) return $"for {Duration(minutes)}";
        return valueIndex.TryGetValue(e.StateValueId, out var p) && p.Value.IsDefault
            ? "which is the default, so it just clears whatever was holding it"
            : "until something else changes it";
    }

    private static string Duration(int minutes)
    {
        if (minutes % 1440 == 0) return Plural(minutes / 1440, "day");
        if (minutes % 60 == 0) return Plural(minutes / 60, "hour");
        return $"{minutes} min";
    }

    private static string Plural(int n, string unit)
    {
        if (n == 1) return $"1 {unit}";
        // "activity" -> "activities" but "day" -> "days": only a consonant + y takes -ies.
        var consonantY = unit.EndsWith('y') && unit.Length > 1 && !"aeiou".Contains(unit[^2]);
        return consonantY ? $"{n} {unit[..^1]}ies" : $"{n} {unit}s";
    }

    private string ValueName(Guid valueId) =>
        valueIndex.TryGetValue(valueId, out var p) ? $"{p.State.Name} = {p.Value.Name}" : "an unknown state value";

    private string StateNameOf(Guid valueId) =>
        valueIndex.TryGetValue(valueId, out var p) ? p.State.Name : "";

    /// <summary>
    /// A requirement set the way the engine reads it: values of one state are ORed, states are ANDed.
    /// </summary>
    private string DescribeRequirements(IEnumerable<Guid> valueIds)
    {
        var wanted = valueIds.ToHashSet();
        var parts = new List<string>();
        foreach (var s in states.OrderBy(s => s.CreatedAt))
        {
            var names = s.Values.OrderBy(v => v.CreatedAt)
                .Where(v => wanted.Contains(v.Id))
                .Select(v => v.Name)
                .ToList();
            if (names.Count > 0) parts.Add($"{s.Name} is {string.Join(" or ", names)}");
        }
        return parts.Count > 0 ? string.Join(", and ", parts) : "an unknown state value holds";
    }

    private List<Occurrence> Occurrences(Activity a) =>
        occurrencesByActivity.TryGetValue(a.Id, out var list) ? list : [];

    /// <summary>The "have I actually been doing this" line, from the activity's own occurrences.</summary>
    private string Stats(Activity a)
    {
        var occs = Occurrences(a);
        if (occs.Count == 0) return "Never scheduled.";

        var done = occs.Where(o => o.Status == EventStatus.done).ToList();
        var parts = new List<string>
        {
            $"{Plural(occs.Count, "occurrence")}: {done.Count} done, {occs.Count(o => o.Status == EventStatus.skipped)} skipped, " +
            $"{occs.Count(o => o.Status == EventStatus.pending)} pending",
        };

        var lastDone = done.Where(o => o.StartAt.HasValue).Select(o => o.StartAt!.Value).DefaultIfEmpty().Max();
        if (lastDone != default) parts.Add($"last done {Date(lastDone)}");

        var lengths = done
            .Select(o => o.StartAt.HasValue && o.EndAt.HasValue
                ? (int)(o.EndAt.Value - o.StartAt.Value).TotalMinutes
                : o.DurationMinutes ?? 0)
            .Where(m => m > 0)
            .ToList();
        if (lengths.Count > 0) parts.Add($"usually {Median(lengths)} min");

        var starts = done.Where(o => o.StartAt.HasValue && !o.IsAllDay)
            .Select(o => (int)Local(o.StartAt!.Value).TimeOfDay.TotalMinutes)
            .ToList();
        if (starts.Count > 0)
        {
            var median = Median(starts);
            parts.Add($"usually around {median / 60:00}:{median % 60:00}");
        }

        return string.Join(" - ", parts);
    }

    private static int Median(List<int> values)
    {
        var sorted = values.OrderBy(v => v).ToList();
        var mid = sorted.Count / 2;
        return sorted.Count % 2 == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    /// <summary>The time column of a history line: a span, a single time, a date, or nothing.</summary>
    private string When(Occurrence o)
    {
        if (!o.StartAt.HasValue) return "no date";
        if (o.IsAllDay) return "all day";
        var start = Clock(o.StartAt.Value);
        return o.EndAt.HasValue ? $"{start}-{Clock(o.EndAt.Value)}" : start;
    }

    private static string Counted(IEnumerable<string> labels)
    {
        var groups = labels.GroupBy(l => l).OrderByDescending(g => g.Count()).ToList();
        var total = groups.Sum(g => g.Count());
        return total == 0 ? "0" : $"{total}: {string.Join(", ", groups.Select(g => $"{g.Count()} {g.Key}"))}";
    }

    // ── time ───────────────────────────────────────────────────────────────────

    private DateTimeOffset Local(DateTimeOffset instant) => TimeZoneInfo.ConvertTime(instant, ctx.TimeZone);
    private string Date(DateTimeOffset instant) => Local(instant).ToString("yyyy-MM-dd", Inv);
    private string Stamp(DateTimeOffset instant) => Local(instant).ToString("yyyy-MM-dd HH:mm", Inv);
    private string Clock(DateTimeOffset instant) => Local(instant).ToString("HH:mm", Inv);

    // ── markdown ───────────────────────────────────────────────────────────────

    private void Line(string text = "") => sb.Append(text).Append('\n');
    private void Heading2(string text) => Line($"## {text}\n");
    private void Heading3(string text) => Line($"### {text}\n");
    private void Bullet(string text, int depth = 0) => Line($"{new string(' ', depth * 2)}- {text}");

    private void TableHeader(params string[] columns)
    {
        Row(columns);
        Row([.. columns.Select(_ => "---")]);
    }

    private void Row(params string[] cells) => Line($"| {string.Join(" | ", cells)} |");

    /// <summary>A pipe in a name would end the table cell it sits in.</summary>
    private static string Cell(string text) => text.Replace("|", "\\|");

    private static string Quote(string text) =>
        string.Join("\n", text.Replace("\r\n", "\n").Split('\n').Select(l => $"> {l}"));
}
