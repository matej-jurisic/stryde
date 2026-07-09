using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Stryde.Core.Migrations
{
    /// <inheritdoc />
    public partial class FixCheckpointSizeValues : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The AddCheckpointSize migration renamed PlannedProgress→Size without converting
            // the data. Any rows that have a numeric value (e.g. '60.0') are invalid; reset them.
            migrationBuilder.Sql("""
                UPDATE Checkpoints
                SET Size = 'normal'
                WHERE Size NOT IN ('tiny', 'small', 'normal', 'big', 'huge')
            """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
        }
    }
}
