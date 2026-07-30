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
}
