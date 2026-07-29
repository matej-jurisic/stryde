namespace Stryde.Core.Enums;

public enum EventStatus { pending, done, skipped }
public enum GoalStatus { focus, active, bench, closed }
public enum CheckpointStatus { pending, reached }
public enum CheckpointSize { tiny, small, normal, big, huge }
public enum ActivityKind { activity, @event }

/// <summary>
/// Scheduling profile: what the activity *is*, in terms the recommendation engine can act on.
/// Distinct from <see cref="ActivityKind"/>, which is the internal activity/event split.
/// See <see cref="Common.ActivityProfiles"/> for what each one does.
/// </summary>
public enum ActivityType { general, training, deepWork, work, commute }

/// <summary>
/// Where a type anchored to another type is placed relative to it. See
/// <see cref="Common.ActivityProfile.AnchorType"/>.
/// </summary>
public enum Adjacency { none, before, after, brackets }

public enum GoalKind { milestone, ongoing }
