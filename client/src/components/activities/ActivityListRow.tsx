import { Check, Lightbulb, LightbulbOff, Pencil, Trash2 } from 'lucide-react'
import type { Activity } from '@/lib/types'
import { activityTypeMeta } from '@/lib/activityTypes'
import { Badge } from '@/components/ui/Badge'
import { ActionMenu } from '@/components/ui/ActionMenu'
import { CategoryIcon } from '@/components/categories/categoryIcons'

const GOAL_TONE: Record<string, 'focus' | 'active' | 'bench' | 'neutral'> = {
  focus: 'focus',
  active: 'active',
  bench: 'bench',
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
  onToggleSuggestions: () => void
  /** Hidden when the section already says it (grouping by that attribute). */
  hideType?: boolean
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
  onToggleSuggestions,
  hideType,
  hideCategory,
  hideGoal,
}: ActivityListRowProps) {
  const muted = activity.excludeFromRecommendations
  const type = activityTypeMeta(activity.type)
  const TypeIcon = type.icon

  // General is the unclassified default - naming it on every row is noise.
  const showType = !hideType && activity.type !== 'general'
  const showCategory = !hideCategory && activity.category
  const showGoal = !hideGoal && activity.goal
  const hasMeta = showType || showCategory || showGoal || activity.subtasks.length > 0

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
        <span
          title={type.label}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ${
            muted ? 'opacity-50' : ''
          }`}
        >
          <TypeIcon className="h-4 w-4" strokeWidth={2} />
        </span>
      )}

      <button
        onClick={selecting ? onToggleSelect : onOpen}
        className="min-w-0 flex-1 text-left"
      >
        <span
          className={`block truncate text-sm ${muted ? 'text-muted-foreground' : 'text-foreground'}`}
        >
          {activity.title}
        </span>
        {hasMeta && (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {showType && (
              <span className="text-xs text-muted-foreground">{type.label}</span>
            )}
            {showCategory && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <CategoryIcon
                  icon={activity.category!.icon}
                  color={activity.category!.color}
                  size={11}
                  strokeWidth={2}
                />
                {activity.category!.name}
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
          {/* Muting is the one action worth a permanent tap target: it is used in streaks. */}
          <button
            onClick={onToggleSuggestions}
            title={muted ? 'Allow suggestions' : 'Stop suggesting this'}
            aria-label={muted ? 'Allow suggestions' : 'Stop suggesting this'}
            aria-pressed={!muted}
            className={`rounded-md p-1.5 transition-colors hover:bg-muted ${
              muted
                ? 'text-muted-foreground/60 hover:text-foreground'
                : 'text-goal-focus hover:text-goal-focus'
            }`}
          >
            {muted ? (
              <LightbulbOff className="h-3.5 w-3.5" strokeWidth={2} />
            ) : (
              <Lightbulb className="h-3.5 w-3.5" strokeWidth={2} />
            )}
          </button>
          <ActionMenu
            ariaLabel={`Actions for ${activity.title}`}
            iconClassName="h-3.5 w-3.5"
            items={[
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
