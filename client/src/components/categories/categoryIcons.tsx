import {
  Heart, Activity, Dumbbell, Pill, Apple, Bike, Wind,
  Briefcase, Laptop, Code2, Calendar, ClipboardList, Target, FileText, Pen,
  DollarSign, CreditCard, Wallet, TrendingUp, PiggyBank,
  BookOpen, GraduationCap, Brain, Bookmark, Lightbulb,
  Users, Home, Coffee, MessageSquare, Phone, Baby,
  Car, Plane, ShoppingCart, UtensilsCrossed, Map,
  Music, Film, Gamepad2, Headphones, Camera,
  Star, Flag, Globe, Trophy, Shield,
  Leaf, Zap, Sun, Mountain, Snowflake, Flower2,
  Clock, Bell, Wrench, Flame, Smile, Sparkles, Timer,
  type LucideProps,
} from 'lucide-react'
import type { FC } from 'react'

type IconComponent = FC<LucideProps>

export const ICON_MAP: Record<string, IconComponent> = {
  // Health & fitness
  Heart, Activity, Dumbbell, Pill, Apple, Bike, Wind, Timer,
  // Work & productivity
  Briefcase, Laptop, Code2, Calendar, ClipboardList, Target, FileText, Pen,
  // Finance
  DollarSign, CreditCard, Wallet, TrendingUp, PiggyBank,
  // Learning
  BookOpen, GraduationCap, Brain, Bookmark, Lightbulb,
  // People & communication
  Users, Home, Coffee, MessageSquare, Phone, Baby,
  // Travel & lifestyle
  Car, Plane, ShoppingCart, UtensilsCrossed, Map,
  // Entertainment
  Music, Film, Gamepad2, Headphones, Camera,
  // Achievements & general
  Star, Flag, Globe, Trophy, Shield,
  // Nature & environment
  Leaf, Zap, Sun, Mountain, Snowflake, Flower2,
  // Misc
  Clock, Bell, Wrench, Flame, Smile, Sparkles,
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
