import { Circle, Dumbbell, Brain, Briefcase, Car, type LucideIcon } from 'lucide-react'
import type { ActivityProfile, ActivityType } from './types'

export interface ActivityTypeMeta {
  value: ActivityType
  label: string
  icon: LucideIcon
  /**
   * What the type is *for*. Deliberately carries no numbers: the numbers are per user now, so
   * anything quantitative is generated from the resolved profile by `describeProfile`.
   */
  blurb: string
}

export const ACTIVITY_TYPES: ActivityTypeMeta[] = [
  { value: 'general',  label: 'General',   icon: Circle,   blurb: 'No special handling: fits wherever there is room.' },
  { value: 'training', label: 'Training',  icon: Dumbbell, blurb: 'Workouts and sessions.' },
  { value: 'deepWork', label: 'Deep work', icon: Brain,    blurb: 'Uninterrupted focus work.' },
  { value: 'work',     label: 'Work',      icon: Briefcase, blurb: 'A day worked on site. What a commute attaches to, so keep it off days worked from home.' },
  { value: 'commute',  label: 'Commute',   icon: Car,      blurb: 'Travel to and from work. Model each direction as its own activity.' },
]

const byValue = new Map(ACTIVITY_TYPES.map((t) => [t.value, t]))

export function activityTypeMeta(type: ActivityType): ActivityTypeMeta {
  return byValue.get(type) ?? ACTIVITY_TYPES[0]
}

/** Normalises a "H:m" window bound to 24h "HH:mm". */
export function formatWindowTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function formatDays(days: number): string {
  return days % 1 === 0 ? String(days) : days.toFixed(1)
}

/** True when the type takes its placement from another type rather than from a window. */
export function isAnchored(p: ActivityProfile): boolean {
  return p.anchorType !== null && p.adjacency !== 'none'
}

/** "either side of work", for a type that attaches to another one. */
export function describeAnchor(p: ActivityProfile): string | null {
  if (!isAnchored(p)) return null
  const anchor = activityTypeMeta(p.anchorType!).label.toLowerCase()
  if (p.adjacency === 'before') return `just before ${anchor}`
  if (p.adjacency === 'after') return `just after ${anchor}`
  return `either side of ${anchor}`
}

/**
 * Plain-language description of what a type does to the engine, generated from the user's own
 * resolved profile. Two sentences: where it gets placed, and how often it comes back around.
 */
export function describeProfile(p: ActivityProfile): { placement: string; rhythm: string } {
  // An anchored type has a window, but nothing reads it while an anchor is present, so quoting one
  // here would describe behaviour the engine does not have.
  const anchor = describeAnchor(p)
  const parts = [
    anchor
      ? `Placed ${anchor}, and only on days that hold one`
      : `Placed ${formatWindowTime(p.windowStart)} to ${formatWindowTime(p.windowEnd)}`,
  ]
  if (p.minBlockMinutes > 0) parts.push(`needs ${p.minBlockMinutes} free minutes`)
  if (p.maxPerDay > 0) parts.push(`max ${p.maxPerDay} a day`)

  const cadence =
    p.cadencePriorDays === 1
      ? 'Daily rhythm assumed until your own history says otherwise'
      : `About every ${formatDays(p.cadencePriorDays)} days until your own history says otherwise`

  const cooldown =
    p.minDueFraction > 0
      ? p.minDueFraction === 0.5
        ? ', and not suggested again until you are halfway to due'
        : `, and not suggested again until you are ${Math.round(p.minDueFraction * 100)}% of the way to due`
      : ''

  return { placement: `${parts.join(', ')}.`, rhythm: `${cadence}${cooldown}.` }
}

/** One-line form, for the type picker. */
export function profileHint(meta: ActivityTypeMeta, profile: ActivityProfile | undefined): string {
  if (!profile) return meta.blurb
  const { placement, rhythm } = describeProfile(profile)
  return `${meta.blurb} ${placement} ${rhythm}`
}
