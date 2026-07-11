import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { ICON_MAP, ICON_NAMES } from '@/components/categories/categoryIcons'
import type { Category } from '@/lib/types'
import { ApiError } from '@/lib/api'

export const PALETTE = [
  '#8499B1', '#ef4444', '#f97316', '#f59e0b', '#fbbf24',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6', '#06b6d4',
  '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7',
  '#ec4899', '#f43f5e', '#78716c', '#64748b',
]

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {PALETTE.map((hex) => (
        <button
          key={hex}
          type="button"
          onClick={() => onChange(hex)}
          className="relative h-7 w-7 rounded-full transition-transform hover:scale-110"
          style={{ backgroundColor: hex }}
        >
          {value === hex && <Check className="absolute inset-0 m-auto h-4 w-4 text-white" strokeWidth={3} />}
        </button>
      ))}
    </div>
  )
}

export function IconPicker({ value, color, onChange }: { value: string | null; color: string; onChange: (i: string | null) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
          value === null ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'
        }`}
        title="No icon"
      >
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: value === null ? color : 'var(--color-muted-foreground)' }} />
      </button>
      {ICON_NAMES.map((name) => {
        const Icon = ICON_MAP[name]
        const selected = value === name
        return (
          <button
            key={name}
            type="button"
            onClick={() => onChange(name)}
            className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
              selected ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'
            }`}
            title={name}
          >
            <Icon
              style={{ width: 15, height: 15, color: selected ? color : 'var(--color-muted-foreground)' }}
              strokeWidth={2}
            />
          </button>
        )
      })}
    </div>
  )
}

interface CategoryModalProps {
  open: boolean
  onClose: () => void
  category?: Category
  onSave: (name: string, color: string, icon: string | null) => Promise<void>
}

export function CategoryModal({ open, onClose, category, onSave }: CategoryModalProps) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(PALETTE[6])
  const [icon, setIcon] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setName(category?.name ?? '')
      setColor(category?.color ?? PALETTE[6])
      setIcon(category?.icon ?? null)
      setError('')
    }
  }, [open, category])

  async function handleSave() {
    if (!name.trim()) { setError('Name is required.'); return }
    setSaving(true)
    try {
      await onSave(name.trim(), color, icon)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={category ? 'Edit Category' : 'New Category'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} loading={saving}>{category ? 'Save' : 'Add Category'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground">Name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => { setName(e.target.value); setError('') }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
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
    </Modal>
  )
}
