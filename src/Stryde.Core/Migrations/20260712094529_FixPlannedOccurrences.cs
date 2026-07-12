using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Stryde.Core.Migrations
{
    /// <inheritdoc />
    public partial class FixPlannedOccurrences : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Fix occurrences that were planned with the old (broken) logic:
            // isPlanned=true but startAt=null, isAllDay=false.
            // Back-fill startAt to midnight UTC of their CreatedAt day and set isAllDay=true.
            migrationBuilder.Sql("""
                UPDATE "Occurrences"
                SET "StartAt" = substr("CreatedAt", 1, 10) || 'T00:00:00+00:00',
                    "IsAllDay" = 1
                WHERE "IsPlanned" = 1 AND "StartAt" IS NULL
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                UPDATE "Occurrences"
                SET "StartAt" = NULL,
                    "IsAllDay" = 0
                WHERE "IsPlanned" = 1 AND substr("StartAt", 12) = '00:00:00+00:00'
                """);
        }
    }
}
