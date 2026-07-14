import { useQuery } from '@tanstack/react-query'
import { CircleDashed } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { insightsApi } from '@/lib/api'
import { CategoryIcon } from '@/components/categories/categoryIcons'
import type { InsightsCategory, InsightsDay } from '@/lib/types'

// ── helpers ────────────────────────────────────────────────────────────────

/** Parse "yyyy-MM-dd" as a local date (Date('yyyy-MM-dd') would be UTC and can shift a day). */
function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// ── sub-components ─────────────────────────────────────────────────────────

function StatTile({ label, value, unit }: { label: string; value: number; unit?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>}
      </p>
    </div>
  )
}

function CompletionChart({ days }: { days: InsightsDay[] }) {
  const max = Math.max(...days.map((d) => d.done), 1)

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-4">
      <div className="flex h-32 items-end gap-1 border-b border-border">
        {days.map((d) => {
          const date = parseDay(d.day)
          const label = `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: ${d.done} completed`
          return (
            <div
              key={d.day}
              aria-label={label}
              className="group relative flex h-full flex-1 flex-col items-center justify-end"
            >
              <div className="pointer-events-none absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground shadow-pop group-hover:block">
                {label}
              </div>
              {d.done > 0 ? (
                <div
                  className="w-full max-w-6 rounded-t bg-primary"
                  style={{ height: `${(d.done / max) * 100}%` }}
                />
              ) : (
                <div className="h-0.5 w-full max-w-6 bg-muted" />
              )}
            </div>
          )
        })}
      </div>
      <div className="mt-1.5 flex gap-1">
        {days.map((d) => (
          <span key={d.day} className="flex-1 text-center text-[10px] text-muted-foreground">
            {parseDay(d.day).toLocaleDateString(undefined, { weekday: 'narrow' })}
          </span>
        ))}
      </div>
    </div>
  )
}

function CategoryRow({ category, max }: { category: InsightsCategory; max: number }) {
  const isUncategorized = category.categoryId === null
  return (
    <li className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex items-center gap-2">
        {isUncategorized ? (
          <CircleDashed className="h-[15px] w-[15px] shrink-0 text-muted-foreground" strokeWidth={2} />
        ) : (
          <CategoryIcon icon={category.icon} color={category.color ?? 'currentColor'} size={15} strokeWidth={2} />
        )}
        <span className={`truncate text-sm ${isUncategorized ? 'text-muted-foreground' : 'text-foreground'}`}>
          {category.name ?? 'No category'}
        </span>
        <span className="ml-auto shrink-0 text-sm text-foreground tabular-nums">{category.done}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full"
          style={{
            width: `${(category.done / max) * 100}%`,
            backgroundColor: isUncategorized ? 'var(--muted-foreground)' : (category.color ?? 'var(--primary)'),
          }}
        />
      </div>
    </li>
  )
}

// ── page ───────────────────────────────────────────────────────────────────

export function InsightsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['insights'],
    queryFn: insightsApi.get,
  })

  const maxCategoryDone = Math.max(...(data?.categories.map((c) => c.done) ?? []), 1)

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader title="Insights" />

      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <div className="mx-auto max-w-2xl">
          {isLoading || !data ? (
            <div className="flex justify-center py-16">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile label="Done today" value={data.doneToday} />
                <StatTile label="Last 7 days" value={data.doneThisWeek} />
                <StatTile label="Last 30 days" value={data.doneLast30Days} />
                <StatTile
                  label="Current streak"
                  value={data.currentStreakDays}
                  unit={data.currentStreakDays === 1 ? 'day' : 'days'}
                />
              </div>

              <section>
                <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Completions, last 14 days
                </h2>
                <CompletionChart days={data.days} />
              </section>

              <section>
                <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  By category, last 30 days
                </h2>
                {data.categories.length === 0 ? (
                  <div className="rounded-lg border border-border px-4 py-8 text-center">
                    <p className="text-sm text-muted-foreground">
                      Nothing completed in the last 30 days yet. Finished tasks will show up here.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-border bg-card">
                    <ul className="divide-y divide-border">
                      {data.categories.map((c) => (
                        <CategoryRow key={c.categoryId ?? 'none'} category={c} max={maxCategoryDone} />
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
