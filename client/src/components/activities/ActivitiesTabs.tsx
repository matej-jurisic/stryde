import { NavLink } from 'react-router-dom'

/**
 * The Activities page and the two vocabularies it is built out of. Types and states are things the
 * user defines, not app preferences, so they live beside the activities they shape rather than in
 * Settings.
 */
const TABS = [
  { to: '/activities',        label: 'Activities', end: true },
  { to: '/activities/types',  label: 'Types',      end: false },
  { to: '/activities/states', label: 'States',     end: false },
]

export function ActivitiesTabs() {
  return (
    <div className="shrink-0 border-b border-border px-4 md:px-6">
      <nav aria-label="Activities sections" className="mx-auto flex max-w-2xl gap-4">
        {TABS.map(({ to, label, end }) => (
          <NavLink key={to} to={to} end={end}>
            {({ isActive }) => (
              <span
                className={`-mb-px block border-b-2 py-2.5 text-xs font-medium transition-colors ${
                  isActive
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
