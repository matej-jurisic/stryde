import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Plus, Pencil, Trash2, Layers } from 'lucide-react'
import { categoriesApi } from '@/lib/api'
import type { Category } from '@/lib/types'
import { CategoryIcon } from '@/components/categories/categoryIcons'
import { CategoryModal } from '@/components/categories/CategoryModal'

export function EventsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [searchParams] = useSearchParams()
  const categoryId = searchParams.get('category')
  const qc = useQueryClient()

  const [catModalOpen, setCatModalOpen] = useState(false)
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

  async function handleCatSave(name: string, color: string, icon: string | null) {
    if (editingCategory) {
      await categoriesApi.update(editingCategory.id, { name, color, icon })
    } else {
      await categoriesApi.create({ name, color, icon })
    }
    qc.invalidateQueries({ queryKey: ['categories'] })
    qc.invalidateQueries({ queryKey: ['events'] })
  }

  if (!open) return null

  return (
    <div className="md:hidden fixed inset-0 z-40 flex">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex w-64 flex-col bg-background border-r border-border">
        <div className="flex items-center justify-between px-4 py-4 border-b border-border">
          <span className="text-sm font-semibold text-foreground">Events</span>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-2">
          <Link
            to="/activities"
            onClick={onClose}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <Layers className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
            Activities
          </Link>

          <Link
            to="/inbox"
            onClick={onClose}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
              !categoryId
                ? 'bg-muted font-semibold text-foreground'
                : 'font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground'
            }`}
          >
            <span className="h-[18px] w-[18px] shrink-0 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
                <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
                <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
              </svg>
            </span>
            Inbox
          </Link>

          {categories.length > 0 && <div className="my-2 border-t border-border" />}

          {categories.map((cat) => {
            const active = categoryId === cat.id
            return (
              <div key={cat.id} className="flex items-center gap-1">
                <Link
                  to={`/inbox?category=${cat.id}`}
                  onClick={onClose}
                  className={`flex flex-1 items-center gap-3 rounded-lg px-3 py-2 pr-2 text-sm transition-colors ${
                    active
                      ? 'bg-muted font-semibold text-foreground'
                      : 'font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  }`}
                >
                  <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
                    <CategoryIcon icon={cat.icon} color={active ? cat.color : 'currentColor'} size={15} strokeWidth={2} />
                  </span>
                  <span className="truncate">{cat.name}</span>
                </Link>
                <button
                  onClick={() => { setEditingCategory(cat); setCatModalOpen(true) }}
                  className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
                <button
                  onClick={() => deleteMutation.mutate(cat.id)}
                  className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </div>
            )
          })}

          <button
            onClick={() => { setEditingCategory(undefined); setCatModalOpen(true) }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <Plus className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
            Add category
          </button>
        </nav>
      </div>

      <CategoryModal
        open={catModalOpen}
        onClose={() => setCatModalOpen(false)}
        category={editingCategory}
        onSave={handleCatSave}
      />
    </div>
  )
}
