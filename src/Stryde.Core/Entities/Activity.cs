using Stryde.Core.Enums;

namespace Stryde.Core.Entities;

public class Activity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public required string Title { get; set; }
    public Guid? CategoryId { get; set; }
    public Guid? GoalId { get; set; }
    public ActivityKind Kind { get; set; } = ActivityKind.activity;
    public ActivityType Type { get; set; } = ActivityType.general;
    public bool ExcludeFromRecommendations { get; set; } = false;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public User User { get; set; } = null!;
    public Category? Category { get; set; }
    public Goal? Goal { get; set; }
    public List<ActivitySubtask> Subtasks { get; set; } = [];

    /// <summary>What doing this activity changes about the world. At most one value per state.</summary>
    public List<ActivityStateEffect> StateEffects { get; set; } = [];

    /// <summary>What has to be true about the world for this to be suggested.</summary>
    public List<ActivityStateRequirement> StateRequirements { get; set; } = [];
}
