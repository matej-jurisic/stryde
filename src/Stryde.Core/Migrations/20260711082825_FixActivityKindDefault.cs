using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Stryde.Core.Migrations
{
    /// <inheritdoc />
    public partial class FixActivityKindDefault : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // AddActivityKind backfilled the new column with '' instead of 'activity',
            // which silently excluded every pre-existing activity from Kind == activity filters.
            migrationBuilder.Sql("UPDATE \"Activities\" SET \"Kind\" = 'activity' WHERE \"Kind\" = ''");

            migrationBuilder.AlterColumn<string>(
                name: "Kind",
                table: "Activities",
                type: "TEXT",
                nullable: false,
                defaultValue: "activity",
                oldClrType: typeof(string),
                oldType: "TEXT",
                oldDefaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "Kind",
                table: "Activities",
                type: "TEXT",
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "TEXT",
                oldDefaultValue: "activity");
        }
    }
}
