import { NavLink } from 'react-router-dom'
import { ClipboardList, CalendarDays, Tags, Target, Layers, Settings } from 'lucide-react'

const navItems = [
  { to: '/plan',       label: 'Plan',       Icon: ClipboardList },
  { to: '/categories?all=true', label: 'Categories', Icon: Tags },
  { to: '/calendar',   label: 'Calendar',   Icon: CalendarDays  },
  { to: '/goals',      label: 'Goals',      Icon: Target        },
  { to: '/activities', label: 'Activities', Icon: Layers        },
  { to: '/settings',   label: 'Settings',   Icon: Settings      },
]

export function BottomNav() {
  return (
    <nav className="flex h-14 shrink-0 items-stretch border-t border-border bg-background md:hidden">
      {navItems.map(({ to, Icon }) => (
        <NavLink key={to} to={to} className="flex flex-1">
          {({ isActive }) => (
            <span
              className={`flex flex-1 items-center justify-center transition-colors ${
                isActive ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <Icon className="h-5 w-5" strokeWidth={2} />
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
