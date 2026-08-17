using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Stryde.Core.Migrations
{
    /// <inheritdoc />
    public partial class AddLlmSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "LlmBaseUrl",
                table: "UserSettings",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "LlmEnabled",
                table: "UserSettings",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "LlmModel",
                table: "UserSettings",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "LlmNoThink",
                table: "UserSettings",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            // 180 rather than the 0 EF infers from the CLR default: an existing row is backfilled
            // with this value, and 0 is outside the range the settings form will accept, so the
            // first save on an upgraded account would fail on a field the user never touched.
            migrationBuilder.AddColumn<int>(
                name: "LlmTimeoutSeconds",
                table: "UserSettings",
                type: "INTEGER",
                nullable: false,
                defaultValue: 180);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LlmBaseUrl",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "LlmEnabled",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "LlmModel",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "LlmNoThink",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "LlmTimeoutSeconds",
                table: "UserSettings");
        }
    }
}
