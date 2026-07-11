import { BarChart2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'

export function InsightsPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader title="Insights" />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <BarChart2 className="h-6 w-6" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Insights coming soon</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Activity trends and goal health will appear here.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
