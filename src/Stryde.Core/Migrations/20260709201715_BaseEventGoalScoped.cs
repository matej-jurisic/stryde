using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Stryde.Core.Migrations
{
    /// <inheritdoc />
    public partial class BaseEventGoalScoped : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Add GoalId as nullable so we can populate it before enforcing NOT NULL
            migrationBuilder.AddColumn<Guid>(
                name: "GoalId",
                table: "BaseEvents",
                type: "TEXT",
                nullable: true);

            // Populate GoalId from the first linked goal in the join table
            migrationBuilder.Sql(@"
                UPDATE BaseEvents
                SET GoalId = (
                    SELECT GoalsId FROM BaseEventGoals WHERE BaseEventId = BaseEvents.Id LIMIT 1
                )
            ");

            // Delete auto-created base events that had no goal link (true orphans)
            migrationBuilder.Sql(@"DELETE FROM BaseEvents WHERE GoalId IS NULL");

            migrationBuilder.DropTable(name: "BaseEventGoals");

            migrationBuilder.CreateIndex(
                name: "IX_BaseEvents_GoalId",
                table: "BaseEvents",
                column: "GoalId");

            migrationBuilder.AddForeignKey(
                name: "FK_BaseEvents_Goals_GoalId",
                table: "BaseEvents",
                column: "GoalId",
                principalTable: "Goals",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_BaseEvents_Goals_GoalId",
                table: "BaseEvents");

            migrationBuilder.DropIndex(
                name: "IX_BaseEvents_GoalId",
                table: "BaseEvents");

            migrationBuilder.DropColumn(
                name: "GoalId",
                table: "BaseEvents");

            migrationBuilder.CreateTable(
                name: "BaseEventGoals",
                columns: table => new
                {
                    BaseEventId = table.Column<Guid>(type: "TEXT", nullable: false),
                    GoalsId = table.Column<Guid>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BaseEventGoals", x => new { x.BaseEventId, x.GoalsId });
                    table.ForeignKey(
                        name: "FK_BaseEventGoals_BaseEvents_BaseEventId",
                        column: x => x.BaseEventId,
                        principalTable: "BaseEvents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_BaseEventGoals_Goals_GoalsId",
                        column: x => x.GoalsId,
                        principalTable: "Goals",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BaseEventGoals_GoalsId",
                table: "BaseEventGoals",
                column: "GoalsId");
        }
    }
}
