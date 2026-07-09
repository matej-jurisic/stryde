import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Check, X, Pencil, CalendarPlus, Trash2, Plus, Clock, Menu, Inbox } from 'lucide-react'
import { eventsApi, categoriesApi } from '@/lib/api'
import type { Category, Event, EventStatus } from '@/lib/types'
import { CategoryIcon } from '@/components/categories/categoryIcons'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EventModal } from '@/components/events/EventModal'
import { CategoryModal } from '@/components/categories/CategoryModal'
import { PageHeader } from '@/components/layout/PageHeader'

// --- date helpers ---

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function formatEventDate(startAt: string, endAt: string | null): string {
  const start = new Date(startAt)
  const now = new Date()
  const todayStart = startOfDay(now)
  const tomorrowStart = new Date(todayStart.getTime() + 86400000)
  const dayStart = startOfDay(start)

  let dayLabel: string
  if (dayStart.getTime() === todayStart.getTime()) {
    dayLabel = 'Today'
  } else if (dayStart.getTime() === tomorrowStart.getTime()) {
    dayLabel = 'Tomorrow'
  } else {
    dayLabel = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  const timeStr = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (endAt) {
    const end = new Date(endAt)
    const endTime = end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    return `${dayLabel}, ${timeStr} - ${endTime}`
  }
  return `${dayLabel}, ${timeStr}`
}

type Group = 'overdue' | 'today' | 'floating' | 'upcoming' | 'done'

function classify(e: Event): Group {
  if (e.status !== 'pending') return 'done'
  if (!e.startAt) return 'floating'
  if (e.isOverdue) return 'overdue'

  const start = new Date(e.startAt)
  const todayStart = startOfDay(new Date())
  const tomorrowStart = new Date(todayStart.getTime() + 86400000)

  if (start < tomorrowStart) return 'today'
  return 'upcoming'
}

const GROUP_ORDER: Group[] = ['overdue', 'today', 'floating', 'upcoming', 'done']

const GROUP_LABELS: Record<Group, string> = {
  overdue: 'Overdue',
  today: 'Today',
  floating: 'Unscheduled',
  upcoming: 'Upcoming',
  done: 'Completed / Skipped',
}

// --- row component ---

interface InboxRowProps {
  event: Event
  onEdit: (e: Event) => void
  onSchedule: (e: Event) => void
}

function InboxRow({ event, onEdit, onSchedule }: InboxRowProps) {
  const qc = useQueryClient()

  const statusMutation = useMutation({
    mutationFn: (status: EventStatus) => eventsApi.setStatus(event.id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => eventsApi.delete(event.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['recommendations'] })
    },
  })

  const isPending = event.status === 'pending'
  const isFloating = !event.startAt

  return (
    <li className="group flex items-center gap-3 border-b border-border bg-card px-5 py-3 last:border-b-0 hover:bg-muted/40 transition-colors">
      {/* Checkbox */}
      <button
        onClick={() => isPending && statusMutation.mutate('done')}
        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
          event.status === 'done'
            ? 'border-primary bg-primary text-primary-foreground'
            : event.status === 'skipped'
              ? 'border-dashed border-muted-foreground text-muted-foreground'
              : 'border-border bg-background hover:border-primary'
        }`}
      >
        {event.status === 'done' && <Check className="h-3 w-3" strokeWidth={3} />}
        {event.status === 'skipped' && <X className="h-3 w-3" strokeWidth={3} />}
      </button>

      {/* Title + meta */}
      <div className="min-w-0 flex-1">
        <span className={`text-sm ${event.status !== 'pending' ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
          {event.title}
        </span>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {event.startAt && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" strokeWidth={2} />
              {formatEventDate(event.startAt, event.endAt)}
            </span>
          )}
          {event.category && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CategoryIcon icon={event.category.icon} color={event.category.color} size={11} strokeWidth={2} />
              {event.category.name}
            </span>
          )}
          {event.goals.map((g) => (
            <Badge key={g.id} tone="focus">{g.title}</Badge>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-0.5">
        {isPending && (
          <>
            <button
              onClick={() => statusMutation.mutate('skipped')}
              title="Skip"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
            {isFloating && (
              <button
                onClick={() => onSchedule(event)}
                title="Schedule"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-primary"
              >
                <CalendarPlus className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            )}
          </>
        )}
        <button
          onClick={() => onEdit(event)}
          title="Edit"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <button
          onClick={() => deleteMutation.mutate()}
          title="Delete"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
    </li>
  )
}

// --- page ---

export function InboxPage() {
  const [searchParams] = useSearchParams()
  const categoryId = searchParams.get('category')
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [modalOpen, setModalOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState<Event | undefined>()
  const [scheduleMode, setScheduleMode] = useState(false)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [catModalOpen, setCatModalOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | undefined>()

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['events', 'all'],
    queryFn: () => eventsApi.list(),
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: categoriesApi.list,
  })

  const deleteCatMutation = useMutation({
    mutationFn: (id: string) => categoriesApi.delete(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      qc.invalidateQueries({ queryKey: ['events'] })
      if (categoryId === id) navigate('/inbox', { replace: true })
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

  function openAddCat() {
    setEditingCategory(undefined)
    setCatModalOpen(true)
  }

  function openEditCat(cat: Category) {
    setEditingCategory(cat)
    setCatModalOpen(true)
  }

  const activeCategory = categoryId ? categories.find((c) => c.id === categoryId) : null
  const visibleEvents = categoryId
    ? events.filter((e) => e.category?.id === categoryId)
    : events.filter((e) => !e.category)

  function openCreate() {
    setEditingEvent(undefined)
    setScheduleMode(false)
    setModalOpen(true)
  }

  function openEdit(event: Event) {
    setEditingEvent(event)
    setScheduleMode(false)
    setModalOpen(true)
  }

  function openSchedule(event: Event) {
    setEditingEvent(event)
    setScheduleMode(true)
    setModalOpen(true)
  }

  const groups = new Map<Group, Event[]>()
  for (const g of GROUP_ORDER) groups.set(g, [])
  for (const e of visibleEvents) groups.get(classify(e))!.push(e)

  // sort each group
  for (const [key, list] of groups) {
    if (key === 'floating' || key === 'done') continue
    list.sort((a, b) => {
      const aDate = a.startAt ? new Date(a.startAt).getTime() : 0
      const bDate = b.startAt ? new Date(b.startAt).getTime() : 0
      return aDate - bDate
    })
  }

  const hasAny = visibleEvents.length > 0

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title={
          activeCategory ? (
            <span className="flex items-center gap-2">
              <CategoryIcon icon={activeCategory.icon} color={activeCategory.color} size={15} strokeWidth={2} />
              {activeCategory.name}
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Inbox className="h-[15px] w-[15px] text-muted-foreground" strokeWidth={2} />
              Inbox
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
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1.5 h-3.5 w-3.5" strokeWidth={2.5} />
            New Event
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <div className="mx-auto max-w-2xl">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : !hasAny ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 15l3.5-9h9L20 15H4z" />
                  <path d="M4 15v4a1 1 0 001 1h14a1 1 0 001-1v-4" />
                  <path d="M9 20a3 3 0 006 0" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Inbox is empty</p>
                <p className="mt-0.5 text-xs text-muted-foreground">All your events will appear here.</p>
              </div>
              <Button size="sm" onClick={openCreate}>New Event</Button>
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
                    <div className="overflow-hidden rounded-lg border border-border">
                      <ul>
                        {list.map((e) => (
                          <InboxRow key={e.id} event={e} onEdit={openEdit} onSchedule={openSchedule} />
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
        key={editingEvent?.id ?? 'new'}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        event={editingEvent}
        focusStartAt={scheduleMode}
      />

      <CategoryModal
        open={catModalOpen}
        onClose={() => setCatModalOpen(false)}
        category={editingCategory}
        onSave={handleCatSave}
      />

      {/* Mobile category drawer */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          {/* Panel */}
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
              {/* Inbox item */}
              <Link
                to="/inbox"
                onClick={() => setDrawerOpen(false)}
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

              {/* Category items */}
              {categories.map((cat) => {
                const active = categoryId === cat.id
                return (
                  <div key={cat.id} className="flex items-center gap-1">
                    <Link
                      to={`/inbox?category=${cat.id}`}
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
                      onClick={() => deleteCatMutation.mutate(cat.id)}
                      className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  </div>
                )
              })}

              {/* Add category */}
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
