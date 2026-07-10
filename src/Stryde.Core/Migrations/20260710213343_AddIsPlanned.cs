using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Stryde.Core.Migrations
{
    /// <inheritdoc />
    public partial class AddIsPlanned : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "WindowEnd",
                table: "Occurrences");

            migrationBuilder.DropColumn(
                name: "WindowStart",
                table: "Occurrences");

            migrationBuilder.RenameColumn(
                name: "WindowDurationMinutes",
                table: "Occurrences",
                newName: "DurationMinutes");

            migrationBuilder.AddColumn<bool>(
                name: "IsPlanned",
                table: "Occurrences",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsPlanned",
                table: "Occurrences");

            migrationBuilder.RenameColumn(
                name: "DurationMinutes",
                table: "Occurrences",
                newName: "WindowDurationMinutes");

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
    }
}
