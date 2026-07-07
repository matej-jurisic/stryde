import { NavLink } from 'react-router-dom'
import { CalendarRange, CalendarDays, Inbox, Target, Settings, Zap } from 'lucide-react'
import { useInboxCount } from './useInboxCount'

const mainNavItems = [
  { to: '/plan',     label: 'Daily Plan', Icon: CalendarRange, badge: false },
  { to: '/inbox',    label: 'Inbox',      Icon: Inbox,         badge: true  },
  { to: '/calendar', label: 'Calendar',   Icon: CalendarDays,  badge: false },
  { to: '/goals',    label: 'Goals',      Icon: Target,        badge: false },
]

function NavItem({
  to,
  label,
  Icon,
  count,
}: {
  to: string
  label: string
  Icon: typeof CalendarRange
  count?: number
}) {
  return (
    <NavLink to={to} className="block">
      {({ isActive }) => (
        <span
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
            isActive
              ? 'bg-muted font-semibold text-foreground'
              : 'font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground'
          }`}
        >
          <Icon
            className={`h-[18px] w-[18px] shrink-0 ${isActive ? 'text-primary' : ''}`}
            strokeWidth={2}
          />
          {label}
          {count != null && count > 0 && (
            <span className="ml-auto rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold text-primary">
              {count}
            </span>
          )}
        </span>
      )}
    </NavLink>
  )
}

export function Sidebar() {
  const inboxCount = useInboxCount()

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-border bg-background">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Zap className="h-4 w-4" strokeWidth={2.5} />
        </div>
        <span className="text-base font-semibold tracking-tight text-foreground">Stryde</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-1">
        <ul className="flex flex-col gap-0.5">
          {mainNavItems.map((item) => (
            <li key={item.to}>
              <NavItem
                to={item.to}
                label={item.label}
                Icon={item.Icon}
                count={item.badge ? inboxCount : undefined}
              />
            </li>
          ))}
        </ul>
      </nav>

      {/* Bottom */}
      <div className="border-t border-border px-3 py-4">
        <NavItem to="/settings" label="Settings" Icon={Settings} />
      </div>
    </aside>
  )
}
