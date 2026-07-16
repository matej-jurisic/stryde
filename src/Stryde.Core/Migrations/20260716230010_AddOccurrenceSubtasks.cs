using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Stryde.Core.Migrations
{
    /// <inheritdoc />
    public partial class AddOccurrenceSubtasks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "OccurrenceSubtaskCompletions");

            migrationBuilder.CreateTable(
                name: "OccurrenceSubtasks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    OccurrenceId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Title = table.Column<string>(type: "TEXT", nullable: false),
                    IsDone = table.Column<bool>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OccurrenceSubtasks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OccurrenceSubtasks_Occurrences_OccurrenceId",
                        column: x => x.OccurrenceId,
                        principalTable: "Occurrences",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_OccurrenceSubtasks_OccurrenceId",
                table: "OccurrenceSubtasks",
                column: "OccurrenceId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "OccurrenceSubtasks");

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
    }
}
