import {
  Circle,
  Sunrise,
  Sunset,
  Dumbbell,
  Brain,
  Wrench,
  Inbox,
  Moon,
  type LucideIcon,
} from 'lucide-react'
import type { ActivityType } from './types'

export interface ActivityTypeMeta {
  value: ActivityType
  label: string
  icon: LucideIcon
  /** What choosing this actually changes in the suggestion engine. Shown under the picker. */
  hint: string
}

export const ACTIVITY_TYPES: ActivityTypeMeta[] = [
  {
    value: 'general',
    label: 'General',
    icon: Circle,
    hint: 'No special handling. Suggested from 8am, no minimum block, weekly rhythm assumed.',
  },
  {
    value: 'habit',
    label: 'Morning habit',
    icon: Sunrise,
    hint: 'Daily rhythm. Suggested early in the day until your own history says otherwise.',
  },
  {
    value: 'eveningHabit',
    label: 'Evening habit',
    icon: Sunset,
    hint: 'Daily rhythm, placed after 6pm. Same cadence as a morning habit, opposite end of the day.',
  },
  {
    value: 'training',
    label: 'Training',
    icon: Dumbbell,
    hint: 'Every few days rather than daily. Needs 45 free minutes, placed from 3pm, and is not suggested again until you are halfway to due.',
  },
  {
    value: 'deepWork',
    label: 'Deep work',
    icon: Brain,
    hint: 'Needs 90 uninterrupted minutes and never gets offered a smaller gap. Max 2 a day, 9am to 5pm.',
  },
  {
    value: 'chore',
    label: 'Chore',
    icon: Wrench,
    hint: 'Gap filler. Fits anywhere from 8am to 9pm, weekly rhythm assumed.',
  },
  {
    value: 'admin',
    label: 'Admin',
    icon: Inbox,
    hint: 'Low-energy work, pushed to the back half of the day (3pm to 9pm).',
  },
  {
    value: 'recovery',
    label: 'Recovery',
    icon: Moon,
    hint: 'Rest and downtime. Afternoon or evening, max 2 a day.',
  },
]

const byValue = new Map(ACTIVITY_TYPES.map((t) => [t.value, t]))

export function activityTypeMeta(type: ActivityType): ActivityTypeMeta {
  return byValue.get(type) ?? ACTIVITY_TYPES[0]
}
