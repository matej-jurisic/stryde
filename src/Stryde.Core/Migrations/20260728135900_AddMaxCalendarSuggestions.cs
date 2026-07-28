using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Stryde.Core.Migrations
{
    /// <inheritdoc />
    public partial class AddMaxCalendarSuggestions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 6, not EF's generated 0: existing rows must land on the entity default,
            // and 0 is outside the 1-12 the settings service accepts
            migrationBuilder.AddColumn<int>(
                name: "MaxCalendarSuggestions",
                table: "UserSettings",
                type: "INTEGER",
                nullable: false,
                defaultValue: 6);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "MaxCalendarSuggestions",
                table: "UserSettings");
        }
    }
}
