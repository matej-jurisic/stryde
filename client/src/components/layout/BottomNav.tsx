import { NavLink } from 'react-router-dom'
import { CalendarRange, CalendarDays, Tags, Target, Layers, Settings } from 'lucide-react'
import { useUncategorizedCount } from './useUncategorizedCount'

const navItems = [
  { to: '/plan',       label: 'Plan',       Icon: CalendarRange, badge: false },
  { to: '/categories', label: 'Categories', Icon: Tags,          badge: true  },
  { to: '/calendar',   label: 'Calendar',   Icon: CalendarDays,  badge: false },
  { to: '/goals',      label: 'Goals',      Icon: Target,        badge: false },
  { to: '/activities', label: 'Activities', Icon: Layers,        badge: false },
  { to: '/settings',   label: 'Settings',   Icon: Settings,      badge: false },
]

export function BottomNav() {
  const uncategorizedCount = useUncategorizedCount()

  return (
    <nav className="flex h-14 shrink-0 items-stretch border-t border-border bg-background md:hidden">
      {navItems.map(({ to, label, Icon, badge }) => (
        <NavLink key={to} to={to} className="flex flex-1">
          {({ isActive }) => (
            <span
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
                isActive ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <span className="relative">
                <Icon className="h-5 w-5" strokeWidth={2} />
                {badge && uncategorizedCount > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-[8px] font-semibold text-primary-foreground">
                    {uncategorizedCount > 9 ? '9+' : uncategorizedCount}
                  </span>
                )}
              </span>
              {label}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
