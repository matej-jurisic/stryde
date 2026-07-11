using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Stryde.Core.Migrations
{
    /// <inheritdoc />
    public partial class SubtaskCompletionPerOccurrence : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsDone",
                table: "ActivitySubtasks");

            migrationBuilder.CreateTable(
                name: "OccurrenceSubtaskCompletions",
                columns: table => new
                {
                    OccurrenceId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SubtaskId = table.Column<Guid>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OccurrenceSubtaskCompletions", x => new { x.OccurrenceId, x.SubtaskId });
                    table.ForeignKey(
                        name: "FK_OccurrenceSubtaskCompletions_ActivitySubtasks_SubtaskId",
                        column: x => x.SubtaskId,
                        principalTable: "ActivitySubtasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_OccurrenceSubtaskCompletions_Occurrences_OccurrenceId",
                        column: x => x.OccurrenceId,
                        principalTable: "Occurrences",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_OccurrenceSubtaskCompletions_SubtaskId",
                table: "OccurrenceSubtaskCompletions",
                column: "SubtaskId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "OccurrenceSubtaskCompletions");

            migrationBuilder.AddColumn<bool>(
                name: "IsDone",
                table: "ActivitySubtasks",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);
        }
    }
}
