namespace Stryde.Core.Entities;

public class OccurrenceSubtaskCompletion
{
    public Guid OccurrenceId { get; set; }
    public Guid SubtaskId { get; set; }

    public Occurrence Occurrence { get; set; } = null!;
    public ActivitySubtask Subtask { get; set; } = null!;
}
