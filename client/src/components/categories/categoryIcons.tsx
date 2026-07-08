import {
  Heart, Activity, Dumbbell,
  Briefcase, Laptop, Code2,
  DollarSign, CreditCard, Wallet,
  BookOpen, GraduationCap, Brain,
  Users, Home, Coffee,
  Car, Plane, ShoppingCart,
  Music, Film, Gamepad2,
  Star, Flag, Globe,
  Leaf, Zap, Sun,
  type LucideProps,
} from 'lucide-react'
import type { FC } from 'react'

type IconComponent = FC<LucideProps>

export const ICON_MAP: Record<string, IconComponent> = {
  Heart, Activity, Dumbbell,
  Briefcase, Laptop, Code2,
  DollarSign, CreditCard, Wallet,
  BookOpen, GraduationCap, Brain,
  Users, Home, Coffee,
  Car, Plane, ShoppingCart,
  Music, Film, Gamepad2,
  Star, Flag, Globe,
  Leaf, Zap, Sun,
}

export const ICON_NAMES = Object.keys(ICON_MAP)

export function CategoryIcon({
  icon,
  color,
  size = 14,
  strokeWidth = 2,
}: {
  icon: string | null | undefined
  color: string
  size?: number
  strokeWidth?: number
}) {
  if (!icon) return <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
  const Icon = ICON_MAP[icon]
  if (!Icon) return <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
  return <Icon style={{ color, width: size, height: size, flexShrink: 0 }} strokeWidth={strokeWidth} />
}
