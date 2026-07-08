using Microsoft.EntityFrameworkCore;
using Stryde.Core.Data;
using Stryde.Core.Dtos;

namespace Stryde.Core.Services;

public class BaseEventService(StrydeDbContext db)
{
    public async Task<List<BaseEventSummaryDto>> SearchAsync(Guid userId, string? q)
    {
        var query = db.BaseEvents
            .Include(b => b.Category)
            .Include(b => b.Goals)
            .Where(b => b.UserId == userId);

        if (!string.IsNullOrWhiteSpace(q))
            query = query.Where(b => b.Title.ToLower().Contains(q.ToLower()));

        var results = await query.OrderBy(b => b.Title).Take(20).ToListAsync();
        return results.Select(BaseEventSummaryDto.FromEntity).ToList();
    }
}
