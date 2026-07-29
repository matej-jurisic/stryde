using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Stryde.Core.Migrations
{
    /// <inheritdoc />
    public partial class ResetRemovedActivityTypes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ActivityType dropped work and commute, whose whole job was the hardcoded anchor relation
            // that States replaces. Same statements as RemoveUnusedActivityTypes, needed again because
            // both values were added after that migration ran. Type is a plain TEXT column, so any
            // surviving row would throw on read as an unmapped enum value.
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
