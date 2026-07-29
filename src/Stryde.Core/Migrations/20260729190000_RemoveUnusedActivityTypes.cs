using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Stryde.Core.Migrations
{
    /// <inheritdoc />
    public partial class RemoveUnusedActivityTypes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ActivityType dropped habit, eveningHabit, chore, admin and recovery. Type is a plain
            // TEXT column, so any surviving row would throw on read as an unmapped enum value.
            migrationBuilder.Sql("""
                UPDATE Activities
                SET Type = 'general'
                WHERE Type NOT IN ('general', 'training', 'deepWork')
            """);

            // Per-type overrides for a type that no longer exists have nothing to override.
            migrationBuilder.Sql("""
                DELETE FROM ActivityTypeSettings
                WHERE Type NOT IN ('general', 'training', 'deepWork')
            """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
        }
    }
}
