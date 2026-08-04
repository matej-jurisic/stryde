import { Check, History, Pencil, Trash2 } from 'lucide-react'
import type { Activity } from '@/lib/types'
import { Badge } from '@/components/ui/Badge'
import { ActionMenu } from '@/components/ui/ActionMenu'
import { CategoryIcon } from '@/components/categories/categoryIcons'

const GOAL_TONE: Record<string, 'focus' | 'active' | 'bench' | 'neutral'> = {
  focus: 'focus',
  active: 'active',
  bench: 'bench',
  neutral: 'neutral',
  closed: 'neutral',
}

interface ActivityListRowProps {
  activity: Activity
  /** True while the page is in multi-select mode: the row selects instead of navigating. */
  selecting: boolean
  selected: boolean
  onToggleSelect: () => void
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
  onHistory: () => void
  /** Hidden when the section already says it (grouping by that attribute). */
  hideCategory?: boolean
  hideGoal?: boolean
}

export function ActivityListRow({
  activity,
  selecting,
  selected,
  onToggleSelect,
  onOpen,
  onEdit,
  onDelete,
  onHistory,
  hideCategory,
  hideGoal,
}: ActivityListRowProps) {
  const category = activity.category

  const showCategory = !hideCategory && category
  const showGoal = !hideGoal && activity.goal
  const hasMeta = showCategory || showGoal || activity.subtasks.length > 0

  return (
    <li
      className={`group flex items-center gap-3 px-3 py-2.5 transition-colors ${
        selected ? 'bg-primary/10' : 'hover:bg-muted/40'
      }`}
    >
      {selecting ? (
        <button
          onClick={onToggleSelect}
          role="checkbox"
          aria-checked={selected}
          aria-label={`Select ${activity.title}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center"
        >
          <span
            className={`flex h-[18px] w-[18px] items-center justify-center rounded border transition-colors ${
              selected
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input bg-background'
            }`}
          >
            {selected && <Check className="h-3 w-3" strokeWidth={3} />}
          </span>
        </button>
      ) : (
        /* The category's own colour, tinted: it already drives every occurrence row and calendar
           block for this activity, so the list reads in the same language as the calendar. */
        <span
          title={category?.name ?? 'No category'}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted"
          style={category ? { backgroundColor: `${category.color}1f` } : undefined}
        >
          <CategoryIcon
            icon={category?.icon}
            color={category?.color ?? 'var(--color-muted-foreground)'}
            size={15}
          />
        </span>
      )}

      <button
        onClick={selecting ? onToggleSelect : onOpen}
        className="min-w-0 flex-1 text-left"
      >
        <span className="block truncate text-sm text-foreground">{activity.title}</span>
        {hasMeta && (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {showCategory && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <CategoryIcon
                  icon={category!.icon}
                  color={category!.color}
                  size={11}
                  strokeWidth={2}
                />
                {category!.name}
              </span>
            )}
            {activity.subtasks.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {activity.subtasks.length}{' '}
                {activity.subtasks.length === 1 ? 'subtask' : 'subtasks'}
              </span>
            )}
            {showGoal && (
              <Badge tone={GOAL_TONE[activity.goal!.status] ?? 'neutral'}>
                {activity.goal!.title}
              </Badge>
            )}
          </span>
        )}
      </button>

      {!selecting && (
        <div className="flex shrink-0 items-center gap-0.5">
          <ActionMenu
            ariaLabel={`Actions for ${activity.title}`}
            iconClassName="h-3.5 w-3.5"
            items={[
              { icon: History, label: 'History', onClick: onHistory },
              { icon: Pencil, label: 'Edit', onClick: onEdit },
              'separator',
              { icon: Trash2, label: 'Delete', onClick: onDelete, destructive: true },
            ]}
          />
        </div>
      )}
    </li>
  )
}
