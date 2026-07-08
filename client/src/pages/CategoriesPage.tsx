import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { categoriesApi, ApiError } from '@/lib/api'
import type { Category } from '@/lib/types'
import { CategoryIcon } from '@/components/categories/categoryIcons'
import { PALETTE, ColorPicker, IconPicker } from '@/components/categories/CategoryModal'

interface CategoryFormProps {
  initial?: { name: string; color: string; icon: string | null }
  onSave: (name: string, color: string, icon: string | null) => Promise<void>
  onCancel: () => void
  submitLabel: string
}

function CategoryForm({ initial, onSave, onCancel, submitLabel }: CategoryFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState(initial?.color ?? PALETTE[6])
  const [icon, setIcon] = useState<string | null>(initial?.icon ?? null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!name.trim()) { setError('Name is required.'); return }
    setSaving(true)
    try {
      await onSave(name.trim(), color, icon)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.')
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground">Name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => { setName(e.target.value); setError('') }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onCancel() }}
          placeholder="e.g. Health, Admin, Learning"
          className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground">Color</label>
        <ColorPicker value={color} onChange={setColor} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground">Icon</label>
        <IconPicker value={icon} color={color} onChange={setIcon} />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} loading={saving}>{submitLabel}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
      </div>
    </div>
  )
}

function CategoryCard({ category }: { category: Category }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: () => categoriesApi.delete(category.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      qc.invalidateQueries({ queryKey: ['events'] })
    },
  })

  async function handleUpdate(name: string, color: string, icon: string | null) {
    await categoriesApi.update(category.id, { name, color, icon })
    qc.invalidateQueries({ queryKey: ['categories'] })
    qc.invalidateQueries({ queryKey: ['events'] })
    setEditing(false)
  }

  if (editing) {
    return (
      <CategoryForm
        initial={{ name: category.name, color: category.color, icon: category.icon }}
        onSave={handleUpdate}
        onCancel={() => setEditing(false)}
        submitLabel="Save"
      />
    )
  }

  return (
    <article className="group flex items-center gap-4 rounded-xl border border-border bg-card p-4">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: category.color + '22' }}
      >
        <CategoryIcon icon={category.icon} color={category.color} size={18} strokeWidth={2} />
      </div>
      <span className="flex-1 text-sm font-medium text-foreground">{category.name}</span>
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={() => setEditing(true)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <button
          onClick={() => deleteMutation.mutate()}
          disabled={deleteMutation.isPending}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
    </article>
  )
}

export function CategoriesPage() {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: categoriesApi.list,
  })

  async function handleCreate(name: string, color: string, icon: string | null) {
    await categoriesApi.create({ name, color, icon })
    qc.invalidateQueries({ queryKey: ['categories'] })
    setAdding(false)
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Categories"
        action={
          !adding ? (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" strokeWidth={2.5} />
              New Category
            </Button>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <div className="mx-auto max-w-lg flex flex-col gap-3">
          {adding && (
            <CategoryForm
              onSave={handleCreate}
              onCancel={() => setAdding(false)}
              submitLabel="Add Category"
            />
          )}

          {isLoading ? (
            <div className="flex justify-center py-16">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : categories.length === 0 && !adding ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
                  <line x1="7" y1="7" x2="7.01" y2="7" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">No categories yet</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Group events that aren't tied to a goal.</p>
              </div>
              <Button size="sm" onClick={() => setAdding(true)}>New Category</Button>
            </div>
          ) : (
            categories.map((cat) => <CategoryCard key={cat.id} category={cat} />)
          )}
        </div>
      </div>
    </div>
  )
}
