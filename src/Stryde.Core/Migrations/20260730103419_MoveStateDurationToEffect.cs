using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Stryde.Core.Migrations
{
    /// <summary>
    /// Moves a state value's expiry onto the effect that sets it, so two activities can put a state
    /// into the same value for different lengths of time: a run leaves you tired for ten hours, a
    /// hike for two days.
    /// </summary>
    public partial class MoveStateDurationToEffect : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "DurationMinutes",
                table: "ActivityStateEffects",
                type: "INTEGER",
                nullable: true);

            // Every effect inherits the duration its value used to carry, which reproduces exactly
            // the timeline the schedule had before this migration.
            migrationBuilder.Sql(
                """
                UPDATE ActivityStateEffects
                SET DurationMinutes = (
                    SELECT DurationMinutes FROM StateValues
                    WHERE StateValues.Id = ActivityStateEffects.StateValueId
                );
                """);

            migrationBuilder.DropColumn(
                name: "DurationMinutes",
                table: "StateValues");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "DurationMinutes",
                table: "StateValues",
                type: "INTEGER",
                nullable: true);

            // Lossy in exactly the direction that motivated the change: per-effect durations collapse
            // to one per value, and the longest is kept as the least surprising survivor.
            migrationBuilder.Sql(
                """
                UPDATE StateValues
                SET DurationMinutes = (
                    SELECT MAX(DurationMinutes) FROM ActivityStateEffects
                    WHERE ActivityStateEffects.StateValueId = StateValues.Id
                );
                """);

            migrationBuilder.DropColumn(
                name: "DurationMinutes",
                table: "ActivityStateEffects");
        }
    }
}
