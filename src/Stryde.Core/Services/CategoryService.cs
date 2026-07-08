using Microsoft.EntityFrameworkCore;
using Stryde.Core.Common;
using Stryde.Core.Data;
using Stryde.Core.Dtos;
using Stryde.Core.Entities;

namespace Stryde.Core.Services;

public class CategoryService(StrydeDbContext db)
{
    public async Task<List<CategoryDto>> ListAsync(Guid userId)
    {
        var cats = await db.Categories.Where(c => c.UserId == userId).ToListAsync();
        return cats.OrderBy(c => c.CreatedAt).Select(CategoryDto.FromEntity).ToList();
    }

    public async Task<Result<CategoryDto>> CreateAsync(Guid userId, CreateCategoryRequest req)
    {
        var err = Validators.ValidateTitle(req.Name, "Name")
            ?? Validators.ValidateColor(req.Color);
        if (err is not null) return Result<CategoryDto>.Fail(err);

        var cat = new Category { UserId = userId, Name = req.Name.Trim(), Color = req.Color, Icon = req.Icon };
        db.Categories.Add(cat);
        await db.SaveChangesAsync();
        return Result<CategoryDto>.Success(CategoryDto.FromEntity(cat));
    }

    public async Task<Result<CategoryDto>> UpdateAsync(Guid id, Guid userId, UpdateCategoryRequest req)
    {
        var err = Validators.ValidateTitle(req.Name, "Name")
            ?? Validators.ValidateColor(req.Color);
        if (err is not null) return Result<CategoryDto>.Fail(err);

        var cat = await db.Categories.FirstOrDefaultAsync(c => c.Id == id && c.UserId == userId);
        if (cat is null) return Result<CategoryDto>.Fail(new Error(ErrorType.NotFound, "Category not found."));

        cat.Name = req.Name.Trim();
        cat.Color = req.Color;
        cat.Icon = req.Icon;
        await db.SaveChangesAsync();
        return Result<CategoryDto>.Success(CategoryDto.FromEntity(cat));
    }

    public async Task<Result> DeleteAsync(Guid id, Guid userId)
    {
        var cat = await db.Categories.FirstOrDefaultAsync(c => c.Id == id && c.UserId == userId);
        if (cat is null) return Result.Fail(new Error(ErrorType.NotFound, "Category not found."));
        db.Categories.Remove(cat);
        await db.SaveChangesAsync();
        return Result.Success();
    }
}
