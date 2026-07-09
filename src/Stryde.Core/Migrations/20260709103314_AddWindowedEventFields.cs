using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Stryde.Core.Migrations
{
    /// <inheritdoc />
    public partial class AddWindowedEventFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "WindowDurationMinutes",
                table: "Events",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "WindowEnd",
                table: "Events",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "WindowStart",
                table: "Events",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "WindowDurationMinutes",
                table: "Events");

            migrationBuilder.DropColumn(
                name: "WindowEnd",
                table: "Events");

            migrationBuilder.DropColumn(
                name: "WindowStart",
                table: "Events");
        }
    }
}
