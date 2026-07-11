using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Stryde.Core.Migrations
{
    /// <inheritdoc />
    public partial class AddOccurrenceWindow : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "WindowDurationMinutes",
                table: "Occurrences",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "WindowEnd",
                table: "Occurrences",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "WindowStart",
                table: "Occurrences",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "WindowDurationMinutes",
                table: "Occurrences");

            migrationBuilder.DropColumn(
                name: "WindowEnd",
                table: "Occurrences");

            migrationBuilder.DropColumn(
                name: "WindowStart",
                table: "Occurrences");
        }
    }
}
