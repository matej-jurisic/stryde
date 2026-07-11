using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Stryde.Core.Migrations
{
    /// <inheritdoc />
    public partial class AddGoalKind : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Kind",
                table: "Goals",
                type: "TEXT",
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Kind",
                table: "Goals");
        }
    }
}
