using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Stryde.Core.Migrations
{
    /// <inheritdoc />
    public partial class RemoveRepeatRules : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Occurrences_RepeatRules_RepeatRuleId",
                table: "Occurrences");

            migrationBuilder.DropTable(
                name: "RepeatRules");

            migrationBuilder.DropIndex(
                name: "IX_Occurrences_RepeatRuleId",
                table: "Occurrences");

            migrationBuilder.DropColumn(
                name: "RepeatRuleId",
                table: "Occurrences");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "RepeatRuleId",
                table: "Occurrences",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "RepeatRules",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Config = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    Pattern = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RepeatRules", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Occurrences_RepeatRuleId",
                table: "Occurrences",
                column: "RepeatRuleId");

            migrationBuilder.AddForeignKey(
                name: "FK_Occurrences_RepeatRules_RepeatRuleId",
                table: "Occurrences",
                column: "RepeatRuleId",
                principalTable: "RepeatRules",
                principalColumn: "Id");
        }
    }
}
