using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Stryde.Core.Migrations
{
    /// <summary>
    /// Repairs the activity types seeded by <c>AddActivityTypes</c>, whose ids were written in
    /// lower-case hex.
    /// <para>
    /// Microsoft.Data.Sqlite binds a <see cref="System.Guid"/> parameter as UPPER-case TEXT, and
    /// SQLite compares TEXT case-sensitively. A lower-case id therefore lists fine (no comparison
    /// involved) but matches nothing: <c>WHERE "Id" = @id</c> never hits, so update and delete both
    /// returned "Activity type not found.", and assigning the type to an activity 404'd on the same
    /// lookup. The FK join failed the same way, so an activity could not resolve its type either.
    /// </para>
    /// </summary>
    public partial class NormalizeActivityTypeIdCase : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Both sides of the FK move in one transaction, so enforcement has to wait for the
            // commit rather than judge the intermediate state.
            migrationBuilder.Sql("PRAGMA defer_foreign_keys = ON;");

            migrationBuilder.Sql("""
                UPDATE "ActivityTypes" SET "Id" = upper("Id") WHERE "Id" <> upper("Id");
                """);

            // Nothing should reference a lower-case id (the lookup that would have written one is
            // exactly what was failing), but a row that predates the FK check would be orphaned by
            // the update above.
            migrationBuilder.Sql("""
                UPDATE "Activities" SET "ActivityTypeId" = upper("ActivityTypeId")
                WHERE "ActivityTypeId" IS NOT NULL AND "ActivityTypeId" <> upper("ActivityTypeId");
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // The case of an id carries no meaning worth restoring, and re-lowering it would put the
            // rows back out of EF's reach.
        }
    }
}
