using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Stryde.Core.Migrations
{
    /// <inheritdoc />
    public partial class AddBaseEvents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "BaseEventId",
                table: "Events",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "BaseEvents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    UserId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Title = table.Column<string>(type: "TEXT", nullable: false),
                    CategoryId = table.Column<Guid>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BaseEvents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BaseEvents_Categories_CategoryId",
                        column: x => x.CategoryId,
                        principalTable: "Categories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_BaseEvents_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

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
                name: "IX_Events_BaseEventId",
                table: "Events",
                column: "BaseEventId");

            migrationBuilder.CreateIndex(
                name: "IX_BaseEventGoals_GoalsId",
                table: "BaseEventGoals",
                column: "GoalsId");

            migrationBuilder.CreateIndex(
                name: "IX_BaseEvents_CategoryId",
                table: "BaseEvents",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_BaseEvents_UserId",
                table: "BaseEvents",
                column: "UserId");

            migrationBuilder.AddForeignKey(
                name: "FK_Events_BaseEvents_BaseEventId",
                table: "Events",
                column: "BaseEventId",
                principalTable: "BaseEvents",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Events_BaseEvents_BaseEventId",
                table: "Events");

            migrationBuilder.DropTable(
                name: "BaseEventGoals");

            migrationBuilder.DropTable(
                name: "BaseEvents");

            migrationBuilder.DropIndex(
                name: "IX_Events_BaseEventId",
                table: "Events");

            migrationBuilder.DropColumn(
                name: "BaseEventId",
                table: "Events");
        }
    }
}
