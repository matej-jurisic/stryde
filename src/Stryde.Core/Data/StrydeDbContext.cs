using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using Stryde.Core.Entities;
using Stryde.Core.Enums;

namespace Stryde.Core.Data;

public class StrydeDbContext(DbContextOptions<StrydeDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<Occurrence> Occurrences => Set<Occurrence>();
    public DbSet<Activity> Activities => Set<Activity>();
    public DbSet<Goal> Goals => Set<Goal>();
    public DbSet<Checkpoint> Checkpoints => Set<Checkpoint>();
    public DbSet<UserSettings> UserSettings => Set<UserSettings>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<ActivityTypeSetting> ActivityTypeSettings => Set<ActivityTypeSetting>();
    public DbSet<ActivitySubtask> ActivitySubtasks => Set<ActivitySubtask>();
    public DbSet<OccurrenceSubtask> OccurrenceSubtasks => Set<OccurrenceSubtask>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<RefreshToken>()
            .Ignore(rt => rt.IsActive);

        modelBuilder.Entity<Occurrence>()
            .Property(o => o.Status)
            .HasConversion<string>();

        modelBuilder.Entity<Occurrence>()
            .HasOne(o => o.Activity)
            .WithMany()
            .HasForeignKey(o => o.ActivityId)
            .OnDelete(DeleteBehavior.Cascade);

        // Every occurrence read filters by UserId (often together with Status); UserId is a bare
        // Guid with no relationship, so EF would not index it otherwise. Occurrences are the
        // highest-volume table, so this is the index that matters most.
        modelBuilder.Entity<Occurrence>()
            .HasIndex(o => new { o.UserId, o.Status });

        modelBuilder.Entity<Activity>()
            .Property(a => a.Kind)
            .HasConversion<string>();

        modelBuilder.Entity<Activity>()
            .Property(a => a.Type)
            .HasConversion<string>();

        modelBuilder.Entity<Activity>()
            .HasOne(a => a.Category)
            .WithMany()
            .HasForeignKey(a => a.CategoryId)
            .OnDelete(DeleteBehavior.SetNull);

        modelBuilder.Entity<Activity>()
            .HasOne(a => a.Goal)
            .WithMany()
            .HasForeignKey(a => a.GoalId)
            .OnDelete(DeleteBehavior.SetNull);

        modelBuilder.Entity<Goal>()
            .HasIndex(g => g.UserId);

        modelBuilder.Entity<Goal>()
            .Property(g => g.Status)
            .HasConversion<string>();

        modelBuilder.Entity<Goal>()
            .Property(g => g.Kind)
            .HasConversion<string>();

        modelBuilder.Entity<Checkpoint>()
            .Property(c => c.Status)
            .HasConversion<string>();

        modelBuilder.Entity<Checkpoint>()
            .Property(c => c.Size)
            .HasConversion<string>();

        modelBuilder.Entity<UserSettings>()
            .HasKey(us => us.UserId);

        modelBuilder.Entity<UserSettings>()
            .HasOne(us => us.User)
            .WithOne()
            .HasForeignKey<UserSettings>(us => us.UserId);

        modelBuilder.Entity<UserSettings>()
            .Property(us => us.DayBoundaryTime)
            .HasConversion(
                v => v.ToString("HH:mm:ss"),
                v => TimeOnly.ParseExact(v, "HH:mm:ss"));


        // One row per (user, type), and only for types the user has actually edited.
        modelBuilder.Entity<ActivityTypeSetting>()
            .HasKey(s => new { s.UserId, s.Type });

        modelBuilder.Entity<ActivityTypeSetting>()
            .Property(s => s.Type)
            .HasConversion<string>();

        // Declared over the non-nullable TimeOnly so EF keeps handling the nulls itself: a null
        // column means "no override", and must not reach ParseExact.
        var timeOnlyToString = new ValueConverter<TimeOnly, string>(
            v => v.ToString("HH:mm:ss"),
            v => TimeOnly.ParseExact(v, "HH:mm:ss"));

        modelBuilder.Entity<ActivityTypeSetting>()
            .Property(s => s.WindowStart)
            .HasConversion(timeOnlyToString);

        modelBuilder.Entity<ActivityTypeSetting>()
            .Property(s => s.WindowEnd)
            .HasConversion(timeOnlyToString);

        modelBuilder.Entity<Checkpoint>()
            .HasOne(c => c.Goal)
            .WithMany(g => g.Checkpoints)
            .HasForeignKey(c => c.GoalId);

        modelBuilder.Entity<ActivitySubtask>()
            .HasOne(s => s.Activity)
            .WithMany(a => a.Subtasks)
            .HasForeignKey(s => s.ActivityId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<OccurrenceSubtask>()
            .HasOne(s => s.Occurrence)
            .WithMany(o => o.Subtasks)
            .HasForeignKey(s => s.OccurrenceId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

public class StrydeDbContextFactory : IDesignTimeDbContextFactory<StrydeDbContext>
{
    public StrydeDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<StrydeDbContext>()
            .UseSqlite("Data Source=stryde-design.db")
            .Options;
        return new StrydeDbContext(options);
    }
}
