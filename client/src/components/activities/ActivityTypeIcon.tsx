import { CircleDashed } from 'lucide-react'
import { ICON_MAP } from '@/components/categories/categoryIcons'

/**
 * The icons the type editor offers: a short curated slice of `ICON_MAP`, not all of it. A type is a
 * scheduling preset and a user owns a handful, so the picker is meant to be scanned at a glance in
 * two or three rows. Rendering still goes through the full map, so a name saved from anywhere else
 * keeps working. Keep the count at 23 - with the "no icon" tile that fills the grid exactly.
 */
export const TYPE_ICON_NAMES = [
  'Circle', 'Dumbbell', 'Heart', 'Bike', 'Apple', 'Leaf',
  'Briefcase', 'Laptop', 'Code2', 'ClipboardList', 'Target', 'Phone',
  'BookOpen', 'Brain', 'Users', 'Home', 'Coffee', 'Sparkles',
  'Car', 'ShoppingCart', 'UtensilsCrossed', 'Music', 'Gamepad2',
]

/**
 * A type's stored lucide name, resolved through the shared icon map. Degrades to a neutral outline
 * for an unknown key and for no type at all - the two cases look the same on purpose, since neither
 * says anything about scheduling.
 */
export function ActivityTypeIcon({
  icon,
  className = 'h-4 w-4',
  strokeWidth = 2,
}: {
  icon: string | null | undefined
  className?: string
  strokeWidth?: number
}) {
  const Icon = (icon && ICON_MAP[icon]) || CircleDashed
  return <Icon className={className} strokeWidth={strokeWidth} />
}
