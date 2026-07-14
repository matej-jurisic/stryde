import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ClipboardList, CalendarDays, Tags, Target, Layers, Settings, ChartColumn, Ellipsis } from 'lucide-react'

const tabs = [
  { to: '/plan',                label: 'Plan',       Icon: ClipboardList },
  { to: '/categories?all=true', label: 'Categories', Icon: Tags },
  { to: '/calendar',            label: 'Calendar',   Icon: CalendarDays },
  { to: '/goals',               label: 'Goals',      Icon: Target },
]

const moreItems = [
  { to: '/activities', label: 'Activities', Icon: Layers },
  { to: '/insights',   label: 'Insights',   Icon: ChartColumn },
  { to: '/settings',   label: 'Settings',   Icon: Settings },
]

function MoreSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:hidden" role="dialog" aria-modal="true" aria-label="More pages">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-modal-overlay"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="relative z-10 rounded-t-2xl border-t border-x border-border bg-background px-3 pb-6 pt-2.5 animate-modal-panel-up"
        style={{ boxShadow: 'var(--shadow-pop-value)' }}
      >
        <div className="flex justify-center pb-2">
          <div className="h-1 w-8 rounded-full bg-border" />
        </div>
        <ul className="flex flex-col gap-0.5">
          {moreItems.map(({ to, label, Icon }) => (
            <li key={to}>
              <NavLink to={to} onClick={onClose} className="block">
                {({ isActive }) => (
                  <span
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                      isActive
                        ? 'bg-muted font-semibold text-foreground'
                        : 'font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                    }`}
                  >
                    <Icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? 'text-primary' : ''}`} strokeWidth={2} />
                    {label}
                  </span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function BottomNav() {
  const [moreOpen, setMoreOpen] = useState(false)
  const { pathname } = useLocation()
  const moreActive = moreItems.some(({ to }) => pathname.startsWith(to))

  return (
    <>
      <nav className="flex h-14 shrink-0 items-stretch border-t border-border bg-background md:hidden">
        {tabs.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className="flex flex-1" aria-label={label}>
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
        <button
          onClick={() => setMoreOpen(true)}
          aria-label="More pages"
          className={`flex flex-1 items-center justify-center transition-colors ${
            moreActive ? 'text-primary' : 'text-muted-foreground'
          }`}
        >
          <Ellipsis className="h-5 w-5" strokeWidth={2} />
        </button>
      </nav>
      {moreOpen && <MoreSheet onClose={() => setMoreOpen(false)} />}
    </>
  )
}
