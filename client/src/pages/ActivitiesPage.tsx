import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  Layers,
  Lightbulb,
  LightbulbOff,
  Search,
  X,
  ChevronDown,
  ListChecks,
  Tags,
  Trash2,
} from "lucide-react";
import { activitiesApi, goalsApi, categoriesApi } from "@/lib/api";
import { toastError } from "@/store/toasts";
import type { Activity } from "@/lib/types";
import { NO_TYPE_LABEL } from "@/lib/activityTypes";
import { useActivityTypes } from "@/lib/useActivityTypes";
import { useStates, describeRequirements } from "@/lib/useStates";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PageHeader } from "@/components/layout/PageHeader";
import { ActivityModal } from "@/components/activities/ActivityModal";
import { ActivityListRow } from "@/components/activities/ActivityListRow";
import { ActivitiesTabs } from "@/components/activities/ActivitiesTabs";
import { BulkAssignModal } from "@/components/activities/BulkAssignModal";

type SuggestFilter = "all" | "suggested" | "muted";

const FILTERS: { value: SuggestFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "suggested", label: "Suggested" },
  { value: "muted", label: "Muted" },
];

type GroupBy = "goal" | "type" | "category" | "states" | "none";

const GROUPS: { value: GroupBy; label: string }[] = [
  { value: "goal", label: "Goal" },
  { value: "type", label: "Type" },
  { value: "category", label: "Category" },
  { value: "states", label: "States" },
  { value: "none", label: "None" },
];

const GROUP_KEY = "stryde-activities-group";
const NONE_BUCKET = "__none__";

function storedGroupBy(): GroupBy {
  const saved = localStorage.getItem(GROUP_KEY);
  return GROUPS.some((g) => g.value === saved) ? (saved as GroupBy) : "goal";
}

interface Section {
  key: string;
  /** Null for the ungrouped view, which renders one headerless card. */
  label: string | null;
  items: Activity[];
}

export function ActivitiesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Activity | undefined>();
  const [deleting, setDeleting] = useState<Activity | null>(null);
  const [filter, setFilter] = useState<SuggestFilter>("all");
  const [groupBy, setGroupBy] = useState<GroupBy>(storedGroupBy);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Multi-select: the page swaps row actions for checkboxes and a bottom action bar.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const { data: activities = [], isLoading } = useQuery({
    queryKey: ["activities"],
    queryFn: () => activitiesApi.list(),
  });

  const { data: goals = [] } = useQuery({
    queryKey: ["goals"],
    queryFn: () => goalsApi.list(),
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => categoriesApi.list(),
  });

  // Seeds the type grouping's buckets, so sections keep the user's own type order rather than
  // appearing in whatever order the activities happen to arrive in.
  const activityTypes = useActivityTypes();

  // Names the requirement sets the states grouping buckets by, and decides whether that grouping is
  // offered at all: with no values defined, nothing can require one.
  const { states } = useStates();
  const hasStates = states.some((s) => s.values.length > 0);
  const groupOptions = hasStates
    ? GROUPS
    : GROUPS.filter((g) => g.value !== "states");
  // A stored "states" preference outlives the last state being deleted, so fall back for this render
  // rather than persisting over a choice the user may get back.
  const group: GroupBy =
    groupBy === "states" && !hasStates ? "goal" : groupBy;

  // Optimistic so the list stays put while toggling several activities in a row.
  const suggestionsMutation = useMutation({
    mutationFn: ({ id, exclude }: { id: string; exclude: boolean }) =>
      activitiesApi.setRecommendations(id, exclude),
    onMutate: async ({ id, exclude }) => {
      await qc.cancelQueries({ queryKey: ["activities"] });
      const previous = qc.getQueryData<Activity[]>(["activities"]);
      qc.setQueryData<Activity[]>(["activities"], (old) =>
        old?.map((a) =>
          a.id === id ? { ...a, excludeFromRecommendations: exclude } : a,
        ),
      );
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(["activities"], ctx.previous);
      toastError(err, "Could not update suggestions for this activity.");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["activities"] });
      qc.invalidateQueries({ queryKey: ["recommendations"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => activitiesApi.delete(id),
    onSuccess: () => {
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ["activities"] });
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["recommendations"] });
    },
    onError: (err) => toastError(err, "Could not delete the activity."),
  });

  // No bulk endpoints exist; these fan out over the single-item routes.
  const bulkSuggestionsMutation = useMutation({
    mutationFn: (exclude: boolean) =>
      Promise.all(
        Array.from(selected).map((id) =>
          activitiesApi.setRecommendations(id, exclude),
        ),
      ),
    onSuccess: () => {
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["activities"] });
      qc.invalidateQueries({ queryKey: ["recommendations"] });
    },
    onError: (err) =>
      toastError(err, "Could not update suggestions for the selected activities."),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: () =>
      Promise.all(Array.from(selected).map((id) => activitiesApi.delete(id))),
    onSuccess: () => {
      setBulkDeleting(false);
      setSelected(new Set());
      setSelecting(false);
      qc.invalidateQueries({ queryKey: ["activities"] });
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["recommendations"] });
    },
    onError: (err) => toastError(err, "Could not delete the selected activities."),
  });

  function openCreate() {
    setEditing(undefined);
    setModalOpen(true);
  }

  function openEdit(a: Activity) {
    setEditing(a);
    setModalOpen(true);
  }

  function chooseGroupBy(value: GroupBy) {
    setGroupBy(value);
    localStorage.setItem(GROUP_KEY, value);
  }

  function toggleCollapsed(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function stopSelecting() {
    setSelecting(false);
    setSelected(new Set());
  }

  const mutedCount = activities.filter(
    (a) => a.excludeFromRecommendations,
  ).length;
  const counts: Record<SuggestFilter, number> = {
    all: activities.length,
    suggested: activities.length - mutedCount,
    muted: mutedCount,
  };

  const query = search.trim().toLowerCase();

  // Search spans the row's visible text, so typing a category or goal narrows the list too.
  const visible = useMemo(() => {
    return activities.filter((a) => {
      if (filter === "muted" && !a.excludeFromRecommendations) return false;
      if (filter === "suggested" && a.excludeFromRecommendations) return false;
      if (!query) return true;
      return [
        a.title,
        a.category?.name,
        a.goal?.title,
        a.type?.name,
      ].some((field) => field?.toLowerCase().includes(query));
    });
  }, [activities, filter, query]);

  // Grouping is keyed by attribute so a new grouping dimension is one entry, not a new branch.
  // Buckets are seeded in canonical order so sections do not reshuffle as the filter changes,
  // then empty ones are dropped and the catch-all bucket is pushed to the end.
  const goalMap = useMemo(() => new Map(goals.map((g) => [g.id, g])), [goals]);

  const sections = useMemo<Section[]>(() => {
    if (group === "none") {
      const items = [...visible].sort((a, b) => a.title.localeCompare(b.title));
      return items.length ? [{ key: "all", label: null, items }] : [];
    }

    const buckets = new Map<string, { label: string; items: Activity[] }>();
    // Every grouping now has a real catch-all: "no type" is a bucket like the others, because it
    // is a choice the user can make rather than an absent value.
    const noneLabel =
      group === "goal"
        ? "No goal"
        : group === "category"
          ? "No category"
          : group === "states"
            ? "Any state"
            : NO_TYPE_LABEL;

    // Seeding only applies where a canonical order exists. A requirement set is not a list the user
    // keeps anywhere, it is whatever combinations the activities happen to name, so the states
    // grouping discovers its buckets and sorts them by label below.
    if (group === "goal") {
      for (const g of goals.filter((g) => g.status !== "closed"))
        buckets.set(g.id, { label: g.title, items: [] });
    } else if (group === "category") {
      for (const c of categories) buckets.set(c.id, { label: c.name, items: [] });
    } else if (group === "type") {
      for (const t of activityTypes ?? []) buckets.set(t.id, { label: t.name, items: [] });
    }
    buckets.set(NONE_BUCKET, { label: noneLabel, items: [] });

    for (const a of visible) {
      // Sorted so two activities requiring the same values land in one bucket whatever order the
      // ids came back in: the group is the set, not the list.
      const requirements =
        group === "states" ? [...a.requiredStateValueIds].sort() : [];
      const key =
        group === "goal"
          ? (a.goalId ?? NONE_BUCKET)
          : group === "category"
            ? (a.categoryId ?? NONE_BUCKET)
            : group === "states"
              ? (requirements.length > 0 ? requirements.join("|") : NONE_BUCKET)
              : (a.activityTypeId ?? NONE_BUCKET);
      if (!buckets.has(key)) {
        const label =
          group === "goal"
            ? (goalMap.get(key)?.title ?? noneLabel)
            : group === "type"
              ? (a.type?.name ?? noneLabel)
              : group === "states"
                ? (describeRequirements(states, requirements) || noneLabel)
                : noneLabel;
        buckets.set(key, { label, items: [] });
      }
      buckets.get(key)!.items.push(a);
    }

    const filled = Array.from(buckets.entries())
      .filter(([, b]) => b.items.length > 0)
      .map(([key, b]) => ({
        key,
        label: b.label,
        items: [...b.items].sort((a, b2) => a.title.localeCompare(b2.title)),
      }));

    if (group === "states") filled.sort((a, b) => a.label.localeCompare(b.label));

    const catchAll = filled.filter((s) => s.key === NONE_BUCKET);
    return [...filled.filter((s) => s.key !== NONE_BUCKET), ...catchAll];
  }, [group, visible, goals, categories, activityTypes, goalMap, states]);

  const selectedActivities = activities.filter((a) => selected.has(a.id));
  const allVisibleSelected =
    visible.length > 0 && visible.every((a) => selected.has(a.id));

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Activities"
        action={
          selecting ? (
            <button
              onClick={stopSelecting}
              className="flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              Done
            </button>
          ) : (
            <div className="flex items-center gap-1">
              {activities.length > 0 && (
                <button
                  onClick={() => setSelecting(true)}
                  aria-label="Select activities"
                  title="Select activities"
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-foreground hover:bg-muted transition-colors"
                >
                  <ListChecks className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              )}
              <button
                onClick={openCreate}
                aria-label="New activity"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-foreground hover:bg-muted transition-colors"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
          )
        }
      />

      <ActivitiesTabs />

      {/* Toolbar sits outside the scroll area so search and filters stay reachable. */}
      {!isLoading && activities.length > 0 && (
        <div className="shrink-0 border-b border-border px-4 py-3 md:px-6">
          <div className="mx-auto flex max-w-2xl flex-col gap-2.5">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                strokeWidth={2}
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title, category, goal..."
                className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              )}
            </div>

            {/* Filter pills left, grouping right: one row on desktop, two on a phone. */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {FILTERS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setFilter(value)}
                    aria-pressed={filter === value}
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                      filter === value
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {label}
                    <span className="opacity-60">{counts[value]}</span>
                  </button>
                ))}
              </div>

              <div className="flex overflow-hidden rounded-md border border-border">
                <span className="hidden items-center border-r border-border px-2.5 text-xs text-muted-foreground sm:flex">
                  Group
                </span>
                {groupOptions.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => chooseGroupBy(value)}
                    aria-pressed={group === value}
                    className={`border-l border-border px-2.5 py-1.5 text-xs font-medium transition-colors first:border-l-0 sm:first:border-l ${
                      group === value
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <div className="mx-auto max-w-2xl">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : activities.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Layers className="h-6 w-6" strokeWidth={1.5} />
              </div>
              <p className="text-sm font-medium text-foreground">
                No activities yet
              </p>
              <button
                onClick={openCreate}
                className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted transition-colors"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                New Activity
              </button>
            </div>
          ) : sections.length === 0 ? (
            <div className="flex flex-col items-center gap-1 py-12 text-center">
              <p className="text-sm text-foreground">
                {query
                  ? "No matches"
                  : filter === "muted"
                    ? "No muted activities"
                    : "Every activity is muted"}
              </p>
              <p className="text-xs text-muted-foreground">
                {query
                  ? `Nothing matches "${search.trim()}".`
                  : filter === "muted"
                    ? "All of your activities can show up in suggestions."
                    : "Nothing can be suggested right now. Unmute an activity to bring suggestions back."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {sections.map((section) => {
                const isCollapsed = collapsed.has(`${group}:${section.key}`);
                const sectionSelected = section.items.every((a) =>
                  selected.has(a.id),
                );
                return (
                  <div key={section.key}>
                    {section.label !== null && (
                      <div className="mb-2 flex items-center gap-2 px-1">
                        <button
                          onClick={() => toggleCollapsed(`${group}:${section.key}`)}
                          aria-expanded={!isCollapsed}
                          className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <ChevronDown
                            className={`h-3 w-3 shrink-0 transition-transform ${
                              isCollapsed ? "-rotate-90" : ""
                            }`}
                            strokeWidth={2.5}
                          />
                          {/* A requirement set can outrun the header, so keep the full text on hover. */}
                          <span className="truncate" title={section.label}>
                            {section.label}
                          </span>
                          <span className="font-normal opacity-60">
                            {section.items.length}
                          </span>
                        </button>
                        {selecting && (
                          <button
                            onClick={() =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                for (const a of section.items) {
                                  if (sectionSelected) next.delete(a.id);
                                  else next.add(a.id);
                                }
                                return next;
                              })
                            }
                            className="ml-auto shrink-0 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                          >
                            {sectionSelected ? "Clear" : "Select all"}
                          </button>
                        )}
                      </div>
                    )}
                    {!isCollapsed && (
                      <div className="overflow-hidden rounded-lg border border-border">
                        <ul className="divide-y divide-border">
                          {section.items.map((a) => (
                            <ActivityListRow
                              key={a.id}
                              activity={a}
                              selecting={selecting}
                              selected={selected.has(a.id)}
                              onToggleSelect={() => toggleSelected(a.id)}
                              onOpen={() => navigate(`/activities/${a.id}`)}
                              onEdit={() => openEdit(a)}
                              onDelete={() => setDeleting(a)}
                              onToggleSuggestions={() =>
                                suggestionsMutation.mutate({
                                  id: a.id,
                                  exclude: !a.excludeFromRecommendations,
                                })
                              }
                              hideGoal={group === "goal"}
                              hideCategory={group === "category"}
                              hideType={group === "type"}
                            />
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {selecting && (
        <div className="shrink-0 border-t border-border bg-background px-4 py-2.5 md:px-6">
          <div className="mx-auto flex max-w-2xl items-center gap-2">
            <button
              onClick={() =>
                setSelected(
                  allVisibleSelected ? new Set() : new Set(visible.map((a) => a.id)),
                )
              }
              className="shrink-0 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {allVisibleSelected ? "Clear" : "Select all"}
            </button>
            <span className="shrink-0 text-xs text-muted-foreground">
              {selected.size} selected
            </span>

            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => bulkSuggestionsMutation.mutate(false)}
                disabled={selected.size === 0 || bulkSuggestionsMutation.isPending}
                title="Allow suggestions"
                className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                <Lightbulb className="h-3.5 w-3.5" strokeWidth={2} />
                <span className="hidden sm:inline">Unmute</span>
              </button>
              <button
                onClick={() => bulkSuggestionsMutation.mutate(true)}
                disabled={selected.size === 0 || bulkSuggestionsMutation.isPending}
                title="Stop suggesting"
                className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                <LightbulbOff className="h-3.5 w-3.5" strokeWidth={2} />
                <span className="hidden sm:inline">Mute</span>
              </button>
              <button
                onClick={() => setAssignOpen(true)}
                disabled={selected.size === 0}
                title="Set goal, category or type"
                className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                <Tags className="h-3.5 w-3.5" strokeWidth={2} />
                <span className="hidden sm:inline">Assign</span>
              </button>
              <button
                onClick={() => setBulkDeleting(true)}
                disabled={selected.size === 0}
                title="Delete selected"
                className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                <span className="hidden sm:inline">Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <ActivityModal
        key={editing?.id ?? "new"}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        activity={editing}
        goals={goals}
        categories={categories}
      />

      <BulkAssignModal
        key={assignOpen ? "assign-open" : "assign-closed"}
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        activities={selectedActivities}
        goals={goals}
        categories={categories}
        onApplied={() => setSelected(new Set())}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        loading={deleteMutation.isPending}
        title="Delete activity?"
        message={`"${deleting?.title ?? ""}" and all of its occurrences will be permanently deleted. This cannot be undone.`}
      />

      <ConfirmDialog
        open={bulkDeleting}
        onClose={() => setBulkDeleting(false)}
        onConfirm={() => bulkDeleteMutation.mutate()}
        loading={bulkDeleteMutation.isPending}
        title={`Delete ${selected.size} ${selected.size === 1 ? "activity" : "activities"}?`}
        message="The selected activities and all of their occurrences will be permanently deleted. This cannot be undone."
      />
    </div>
  );
}
