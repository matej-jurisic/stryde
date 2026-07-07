using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Stryde.Core.Entities;
using Stryde.Core.Enums;

namespace Stryde.Core.Data;

public class StrydeDbContext(DbContextOptions<StrydeDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<Event> Events => Set<Event>();
    public DbSet<Goal> Goals => Set<Goal>();
    public DbSet<Checkpoint> Checkpoints => Set<Checkpoint>();
    public DbSet<RepeatRule> RepeatRules => Set<RepeatRule>();
    public DbSet<UserSettings> UserSettings => Set<UserSettings>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<RefreshToken>()
            .Ignore(rt => rt.IsActive);

        modelBuilder.Entity<Event>()
            .Property(e => e.Status)
            .HasConversion<string>();

        modelBuilder.Entity<Goal>()
            .Property(g => g.Status)
            .HasConversion<string>();

        modelBuilder.Entity<Checkpoint>()
            .Property(c => c.Status)
            .HasConversion<string>();

        modelBuilder.Entity<Event>()
            .HasMany(e => e.Goals)
            .WithMany(g => g.Events)
            .UsingEntity(j => j.ToTable("EventGoals"));

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

        modelBuilder.Entity<Checkpoint>()
            .HasOne(c => c.Goal)
            .WithMany(g => g.Checkpoints)
            .HasForeignKey(c => c.GoalId);
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
