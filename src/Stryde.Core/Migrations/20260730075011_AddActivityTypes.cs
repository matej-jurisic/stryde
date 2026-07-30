using System;
using System.Globalization;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Stryde.Core.Migrations
{
    /// <inheritdoc />
    public partial class AddActivityTypes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ActivityTypeSettings");

            migrationBuilder.DropColumn(
                name: "Type",
                table: "Activities");

            migrationBuilder.AddColumn<Guid>(
                name: "ActivityTypeId",
                table: "Activities",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ActivityTypes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    UserId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", nullable: false),
                    Icon = table.Column<string>(type: "TEXT", nullable: true),
                    WindowStart = table.Column<string>(type: "TEXT", nullable: false),
                    WindowEnd = table.Column<string>(type: "TEXT", nullable: false),
                    MinBlockMinutes = table.Column<int>(type: "INTEGER", nullable: false),
                    MaxPerDay = table.Column<int>(type: "INTEGER", nullable: false),
                    CadencePriorDays = table.Column<double>(type: "REAL", nullable: false),
                    MinDueFraction = table.Column<double>(type: "REAL", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ActivityTypes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ActivityTypes_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Activities_ActivityTypeId",
                table: "Activities",
                column: "ActivityTypeId");

            migrationBuilder.CreateIndex(
                name: "IX_ActivityTypes_UserId",
                table: "ActivityTypes",
                column: "UserId");

            migrationBuilder.AddForeignKey(
                name: "FK_Activities_ActivityTypes_ActivityTypeId",
                table: "Activities",
                column: "ActivityTypeId",
                principalTable: "ActivityTypes",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            // Existing activities all land on ActivityTypeId NULL, which is the unconstrained
            // profile - the old Type column carried nothing worth preserving. But seeding only runs
            // at registration, so without this an already-registered user would open an empty
            // Activity types screen with no idea what a type is for.
            //
            // Values are inlined rather than read from ActivityTypeService.DefaultsFor: a migration
            // that calls into live application code breaks the moment that code changes. They must
            // agree at the point this shipped, and after that they are frozen history.
            SeedDefaultType(migrationBuilder, "General", "Circle", "08:00:00", "21:00:00", 0, 0, 7.0, 0, 0);
            SeedDefaultType(migrationBuilder, "Training", "Dumbbell", "15:00:00", "21:00:00", 45, 2, 2.5, 0.5, 1);
            SeedDefaultType(migrationBuilder, "Deep work", "Brain", "09:00:00", "17:00:00", 90, 2, 2.5, 0, 2);
        }

        /// <summary>
        /// One default type for every existing user. <paramref name="ordinal"/> only staggers
        /// CreatedAt: the list is ordered by it, so equal timestamps would leave the three in an
        /// arbitrary order.
        /// </summary>
        private static void SeedDefaultType(
            MigrationBuilder migrationBuilder, string name, string icon,
            string windowStart, string windowEnd, int minBlockMinutes, int maxPerDay,
            double cadencePriorDays, double minDueFraction, int ordinal)
        {
            // SQLite has no uuid() - this is the standard randomblob construction, and it is
            // re-evaluated per row because randomblob is non-deterministic.
            //
            // UPPERCASE, not lower: Microsoft.Data.Sqlite binds a Guid parameter as upper-case TEXT,
            // and SQLite compares TEXT case-sensitively, so a lower-case id is a row EF can list but
            // never match by key. See NormalizeActivityTypeIdCase, which repairs the DBs that ran
            // this before the fix.
            const string NewGuid = """
                upper(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                    || substr(hex(randomblob(2)), 2) || '-'
                    || substr('89AB', abs(random()) % 4 + 1, 1)
                    || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
                """;

            // The format EF's SQLite provider reads a DateTimeOffset back from.
            var createdAt = $"2026-07-30 00:00:0{ordinal}.0000000+00:00";

            migrationBuilder.Sql($"""
                INSERT INTO "ActivityTypes"
                    ("Id", "UserId", "Name", "Icon", "WindowStart", "WindowEnd",
                     "MinBlockMinutes", "MaxPerDay", "CadencePriorDays", "MinDueFraction", "CreatedAt")
                SELECT {NewGuid}, u."Id", '{name}', '{icon}', '{windowStart}', '{windowEnd}',
                       {minBlockMinutes}, {maxPerDay}, {cadencePriorDays.ToString(CultureInfo.InvariantCulture)},
                       {minDueFraction.ToString(CultureInfo.InvariantCulture)}, '{createdAt}'
                FROM "Users" u;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Activities_ActivityTypes_ActivityTypeId",
                table: "Activities");

            migrationBuilder.DropTable(
                name: "ActivityTypes");

            migrationBuilder.DropIndex(
                name: "IX_Activities_ActivityTypeId",
                table: "Activities");

            migrationBuilder.DropColumn(
                name: "ActivityTypeId",
                table: "Activities");

            migrationBuilder.AddColumn<string>(
                name: "Type",
                table: "Activities",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "ActivityTypeSettings",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Type = table.Column<string>(type: "TEXT", nullable: false),
                    MaxPerDay = table.Column<int>(type: "INTEGER", nullable: true),
                    MinBlockMinutes = table.Column<int>(type: "INTEGER", nullable: true),
                    WindowEnd = table.Column<string>(type: "TEXT", nullable: true),
                    WindowStart = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ActivityTypeSettings", x => new { x.UserId, x.Type });
                });
        }
    }
}
