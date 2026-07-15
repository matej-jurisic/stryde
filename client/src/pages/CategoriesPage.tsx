import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { X, Pencil, Trash2, Plus, Menu, CircleDashed, LayoutList } from 'lucide-react'
import { occurrencesApi, categoriesApi } from '@/lib/api'
import { isUncategorized } from '@/lib/categories'
import { toastError } from '@/store/toasts'
import type { Category, Occurrence } from '@/lib/types'
import { CategoryIcon } from '@/components/categories/categoryIcons'
import { EventModal } from '@/components/events/EventModal'
import { OccurrenceListRow } from '@/components/events/OccurrenceListRow'
import { CategoryModal } from '@/components/categories/CategoryModal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { PageHeader } from '@/components/layout/PageHeader'

// --- date helpers ---

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function formatDuration(minutes: number | null): string {
  if (!minutes) return ''
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

function getDayLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const todayStart = startOfDay(now)
  const tomorrowStart = new Date(todayStart.getTime() + 86400000)
  const dayStart = startOfDay(d)
  if (dayStart.getTime() === todayStart.getTime()) return 'Today'
  if (dayStart.getTime() === tomorrowStart.getTime()) return 'Tomorrow'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatOccurrenceDate(o: Occurrence): string {
  const refIso = o.startAt ?? o.endAt
  if (!refIso) return ''
  if (o.isAllDay) {
    const dur = formatDuration(o.durationMinutes)
    return dur ? `${getDayLabel(refIso)}, Date only · ~${dur}` : `${getDayLabel(refIso)}, Date only`
  }
  const dayLabel = getDayLabel(refIso)
  if (o.startAt && o.endAt) {
    const range = `${formatTime(o.startAt)} - ${formatTime(o.endAt)}`
    const dur = formatDuration(o.durationMinutes)
    return dur ? `${dayLabel}, ${range} ~${dur}` : `${dayLabel}, ${range}`
  }
  if (o.startAt) return `${dayLabel}, ${formatTime(o.startAt)}`
  return `${dayLabel}, Due ${formatTime(o.endAt!)}`
}

type Group = 'overdue' | 'today' | 'planned' | 'floating' | 'upcoming' | 'done'

function classify(o: Occurrence): Group {
  if (o.status !== 'pending') return 'done'
  if (o.isPlanned) return 'planned'
  if (!o.startAt && !o.endAt && !o.isAllDay) return 'floating'
  if (o.isOverdue) return 'overdue'

  const ref = o.startAt ?? o.endAt
  if (!ref) return 'upcoming'
  const start = new Date(ref)
  const todayStart = startOfDay(new Date())
  const tomorrowStart = new Date(todayStart.getTime() + 86400000)

  if (start < tomorrowStart) return 'today'
  return 'upcoming'
}

const GROUP_ORDER: Group[] = ['overdue', 'today', 'planned', 'upcoming', 'floating', 'done']

const GROUP_LABELS: Record<Group, string> = {
  overdue: 'Overdue',
  today: 'Today',
  planned: 'Planned',
  upcoming: 'Upcoming',
  floating: 'Floating',
  done: 'Completed / Skipped',
}

// --- page ---

export function CategoriesPage() {
  const [searchParams] = useSearchParams()
  const categoryId = searchParams.get('category')
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [modalOpen, setModalOpen] = useState(false)
  const [editingOccurrence, setEditingOccurrence] = useState<Occurrence | undefined>()
  const [scheduleMode, setScheduleMode] = useState(false)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [catModalOpen, setCatModalOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | undefined>()
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null)

  const { data: occurrences = [], isLoading } = useQuery({
    queryKey: ['events', 'all'],
    queryFn: () => occurrencesApi.list(),
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: categoriesApi.list,
  })

  const deleteCatMutation = useMutation({
    mutationFn: (id: string) => categoriesApi.delete(id),
    onSuccess: (_, id) => {
      setDeletingCategory(null)
      qc.invalidateQueries({ queryKey: ['categories'] })
      qc.invalidateQueries({ queryKey: ['events'] })
      if (categoryId === id) navigate('/categories', { replace: true })
    },
    onError: (err) => toastError(err, 'Could not delete the category.'),
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

  function openAddCat() {
    setEditingCategory(undefined)
    setCatModalOpen(true)
  }

  function openEditCat(cat: Category) {
    setEditingCategory(cat)
    setCatModalOpen(true)
  }

  const showActive = searchParams.get('all') === 'true'
  const activeCategory = categoryId ? categories.find((c) => c.id === categoryId) : null

  const visibleOccurrences = showActive
    ? occurrences.filter((o) => o.status === 'pending')
    : categoryId
      ? occurrences.filter((o) => o.activity.category?.id === categoryId)
      : occurrences.filter(isUncategorized)

  function openCreate() {
    setEditingOccurrence(undefined)
    setScheduleMode(false)
    setModalOpen(true)
  }

  function openEdit(o: Occurrence) {
    setEditingOccurrence(o)
    setScheduleMode(false)
    setModalOpen(true)
  }

  function openSchedule(o: Occurrence) {
    setEditingOccurrence(o)
    setScheduleMode(true)
    setModalOpen(true)
  }

  const groups = new Map<Group, Occurrence[]>()
  for (const g of GROUP_ORDER) groups.set(g, [])
  for (const o of visibleOccurrences) groups.get(classify(o))!.push(o)

  for (const [key, list] of groups) {
    if (key === 'floating' || key === 'done') continue
    list.sort((a, b) => {
      const aDate = a.startAt ? new Date(a.startAt).getTime() : 0
      const bDate = b.startAt ? new Date(b.startAt).getTime() : 0
      return aDate - bDate
    })
  }

  const hasAny = visibleOccurrences.length > 0

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title={
          showActive ? (
            'Active'
          ) : activeCategory ? (
            <span className="flex items-center gap-2">
              <CategoryIcon icon={activeCategory.icon} color={activeCategory.color} size={15} strokeWidth={2} />
              {activeCategory.name}
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <CircleDashed className="h-[15px] w-[15px] text-muted-foreground" strokeWidth={2} />
              No category
            </span>
          )
        }
        leading={
          <button
            onClick={() => setDrawerOpen(true)}
            className="md:hidden flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Open categories"
          >
            <Menu className="h-4 w-4" strokeWidth={2} />
          </button>
        }
        action={
          <button
            onClick={openCreate}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-foreground hover:bg-muted transition-colors"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-3 py-4 md:px-6 md:py-6">
        <div>
          {isLoading ? (
            <div className="flex justify-center py-16">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : !hasAny ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <CircleDashed className="h-6 w-6" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {showActive ? 'Nothing active right now' : activeCategory ? 'Nothing in this category yet' : 'No uncategorized items'}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {showActive
                    ? 'Pending occurrences across every category will appear here.'
                    : activeCategory
                      ? 'Occurrences of activities in this category will appear here.'
                      : 'Occurrences of activities without a category will appear here.'}
                </p>
              </div>
              <button
                onClick={openCreate}
                className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted transition-colors"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                New
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {GROUP_ORDER.map((key) => {
                const list = groups.get(key)!
                if (list.length === 0) return null
                return (
                  <div key={key}>
                    <p className={`mb-2 px-1 text-xs font-semibold uppercase tracking-wide ${
                        key === 'overdue' ? 'text-destructive' : 'text-muted-foreground'
                      }`}>
                        {GROUP_LABELS[key]}
                      </p>
                    <div className="rounded-lg border border-border">
                      <ul>
                        {list.map((o) => (
                          <OccurrenceListRow
                            key={o.id}
                            occurrence={o}
                            timeText={formatOccurrenceDate(o) || null}
                            onEdit={openEdit}
                            onSchedule={openSchedule}
                          />
                        ))}
                      </ul>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <EventModal
        key={`${editingOccurrence?.id ?? 'new'}-${scheduleMode}`}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        occurrence={editingOccurrence}
        focusStartAt={scheduleMode}
        scheduleOnly={scheduleMode}
      />

      <CategoryModal
        open={catModalOpen}
        onClose={() => setCatModalOpen(false)}
        category={editingCategory}
        onSave={handleCatSave}
      />

      <ConfirmDialog
        open={deletingCategory !== null}
        onClose={() => setDeletingCategory(null)}
        onConfirm={() => deletingCategory && deleteCatMutation.mutate(deletingCategory.id)}
        loading={deleteCatMutation.isPending}
        title="Delete category?"
        message={`"${deletingCategory?.name ?? ''}" will be deleted. Activities in this category will be kept without a category.`}
      />

      {/* Mobile category drawer */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="relative z-10 flex w-64 flex-col bg-background border-r border-border">
            <div className="flex items-center justify-between px-4 py-4 border-b border-border">
              <span className="text-sm font-semibold text-foreground">Categories</span>
              <button
                onClick={() => setDrawerOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 py-2">
              <Link
                to="/categories?all=true"
                onClick={() => setDrawerOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  showActive
                    ? 'bg-muted font-semibold text-foreground'
                    : 'font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                }`}
              >
                <span className="h-[18px] w-[18px] shrink-0 flex items-center justify-center">
                  <LayoutList className={`h-[15px] w-[15px] ${showActive ? 'text-primary' : ''}`} strokeWidth={2} />
                </span>
                Active
              </Link>

              <div className="my-2 border-t border-border" />

              <Link
                to="/categories"
                onClick={() => setDrawerOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  !categoryId && !showActive
                    ? 'bg-muted font-semibold text-foreground'
                    : 'font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                }`}
              >
                <span className="h-[18px] w-[18px] shrink-0 flex items-center justify-center">
                  <CircleDashed className="h-[15px] w-[15px]" strokeWidth={2} />
                </span>
                No category
              </Link>

              {categories.length > 0 && <div className="my-2 border-t border-border" />}

              {categories.map((cat) => {
                const active = categoryId === cat.id
                return (
                  <div key={cat.id} className="flex items-center gap-1">
                    <Link
                      to={`/categories?category=${cat.id}`}
                      onClick={() => setDrawerOpen(false)}
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
                      onClick={() => { openEditCat(cat); setDrawerOpen(false) }}
                      className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                    <button
                      onClick={() => { setDeletingCategory(cat); setDrawerOpen(false) }}
                      aria-label={`Delete ${cat.name}`}
                      className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  </div>
                )
              })}

              <button
                onClick={() => { openAddCat(); setDrawerOpen(false) }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              >
                <Plus className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
                Add category
              </button>
            </nav>
          </div>
        </div>
      )}
    </div>
  )
}
