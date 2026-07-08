import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarRange, CalendarDays, Inbox, Target, Settings, Zap, Pencil, Trash2, Plus } from 'lucide-react'
import { useInboxCount } from './useInboxCount'
import { categoriesApi } from '@/lib/api'
import { CategoryIcon } from '@/components/categories/categoryIcons'
import { CategoryModal } from '@/components/categories/CategoryModal'
import type { Category } from '@/lib/types'

function NavItem({
  to,
  label,
  Icon,
  count,
  isActive,
}: {
  to: string
  label: string
  Icon: typeof CalendarRange
  count?: number
  isActive?: boolean
}) {
  return (
    <NavLink to={to} className="block" end>
      {({ isActive: routerActive }) => {
        const active = isActive ?? routerActive
        return (
          <span
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
              active
                ? 'bg-muted font-semibold text-foreground'
                : 'font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground'
            }`}
          >
            <Icon
              className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-primary' : ''}`}
              strokeWidth={2}
            />
            {label}
            {count != null && count > 0 && (
              <span className="ml-auto rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold text-primary">
                {count}
              </span>
            )}
          </span>
        )
      }}
    </NavLink>
  )
}

function InboxItem({ count }: { count: number }) {
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const active = location.pathname === '/inbox' && !params.has('category')

  return (
    <NavLink to="/inbox" className="block" end>
      <span
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
          active
            ? 'bg-muted font-semibold text-foreground'
            : 'font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground'
        }`}
      >
        <Inbox
          className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-primary' : ''}`}
          strokeWidth={2}
        />
        Inbox
        {count > 0 && (
          <span className="ml-auto rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold text-primary">
            {count}
          </span>
        )}
      </span>
    </NavLink>
  )
}

function CategoryItem({
  id, name, color, icon, onEdit, onDelete,
}: {
  id: string; name: string; color: string; icon: string | null;
  onEdit: () => void; onDelete: () => void;
}) {
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const active = location.pathname === '/inbox' && params.get('category') === id

  return (
    <div className="group relative">
      <NavLink to={`/inbox?category=${id}`} className="block">
        <span
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 pr-14 text-sm transition-colors ${
            active
              ? 'bg-muted font-semibold text-foreground'
              : 'font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground'
          }`}
        >
          <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
            <CategoryIcon icon={icon} color={active ? color : 'currentColor'} size={15} strokeWidth={2} />
          </span>
          <span className="truncate">{name}</span>
        </span>
      </NavLink>
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={onEdit}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Pencil className="h-3 w-3" strokeWidth={2} />
        </button>
        <button
          onClick={onDelete}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
        >
          <Trash2 className="h-3 w-3" strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}

export function Sidebar() {
  const inboxCount = useInboxCount()
  const qc = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | undefined>()

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: categoriesApi.list,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => categoriesApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      qc.invalidateQueries({ queryKey: ['events'] })
    },
  })

  async function handleSave(name: string, color: string, icon: string | null) {
    if (editingCategory) {
      await categoriesApi.update(editingCategory.id, { name, color, icon })
    } else {
      await categoriesApi.create({ name, color, icon })
    }
    qc.invalidateQueries({ queryKey: ['categories'] })
    qc.invalidateQueries({ queryKey: ['events'] })
  }

  function openAdd() {
    setEditingCategory(undefined)
    setModalOpen(true)
  }

  function openEdit(cat: Category) {
    setEditingCategory(cat)
    setModalOpen(true)
  }

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
          <li><NavItem to="/plan"     label="Daily Plan" Icon={CalendarRange} /></li>
          <li><NavItem to="/calendar" label="Calendar"   Icon={CalendarDays} /></li>
          <li><NavItem to="/goals"    label="Goals"      Icon={Target} /></li>
        </ul>

        <div className="my-2 border-t border-border" />

        <ul className="flex flex-col gap-0.5">
          <li><InboxItem count={inboxCount} /></li>
          {categories.map((cat) => (
            <li key={cat.id}>
              <CategoryItem
                id={cat.id}
                name={cat.name}
                color={cat.color}
                icon={cat.icon}
                onEdit={() => openEdit(cat)}
                onDelete={() => deleteMutation.mutate(cat.id)}
              />
            </li>
          ))}
          <li>
            <button
              onClick={openAdd}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <Plus className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
              Add category
            </button>
          </li>
        </ul>
      </nav>

      {/* Bottom */}
      <div className="border-t border-border px-3 py-4">
        <NavItem to="/settings" label="Settings" Icon={Settings} />
      </div>

      <CategoryModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        category={editingCategory}
        onSave={handleSave}
      />
    </aside>
  )
}
