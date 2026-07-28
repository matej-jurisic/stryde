import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Plus, Pencil, Trash2, Layers, Lightbulb, LightbulbOff } from "lucide-react";
import { activitiesApi, goalsApi, categoriesApi } from "@/lib/api";
import { toastError } from "@/store/toasts";
import type { Activity } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CategoryIcon } from "@/components/categories/categoryIcons";
import { PageHeader } from "@/components/layout/PageHeader";
import { ActivityModal } from "@/components/activities/ActivityModal";

const GOAL_TONE: Record<string, "focus" | "active" | "bench" | "neutral"> = {
  focus: "focus",
  active: "active",
  bench: "bench",
  closed: "neutral",
};

type SuggestFilter = "all" | "suggested" | "muted";

const FILTERS: { value: SuggestFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "suggested", label: "Suggested" },
  { value: "muted", label: "Muted" },
];

// --- Activity row ---

function ActivityRow({
  activity,
  onView,
  onEdit,
  onDelete,
  onToggleSuggestions,
}: {
  activity: Activity;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleSuggestions: () => void;
}) {
  const muted = activity.excludeFromRecommendations;
  return (
    <li className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40">
      <button onClick={onView} className="min-w-0 flex-1 text-left">
        <span className="text-sm text-foreground">{activity.title}</span>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {activity.category && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CategoryIcon
                icon={activity.category.icon}
                color={activity.category.color}
                size={11}
                strokeWidth={2}
              />
              {activity.category.name}
            </span>
          )}
          {activity.goal && (
            <Badge tone={GOAL_TONE[activity.goal.status] ?? "neutral"}>
              {activity.goal.title}
            </Badge>
          )}
          {activity.subtasks.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {activity.subtasks.length} {activity.subtasks.length === 1 ? 'subtask' : 'subtasks'}
            </span>
          )}
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          onClick={onToggleSuggestions}
          title={muted ? "Allow suggestions" : "Stop suggesting this"}
          aria-label={muted ? "Allow suggestions" : "Stop suggesting this"}
          aria-pressed={!muted}
          className={`rounded-md p-1.5 transition-colors hover:bg-muted ${
            muted
              ? "text-muted-foreground/60 hover:text-foreground"
              : "text-goal-focus hover:text-goal-focus"
          }`}
        >
          {muted ? (
            <LightbulbOff className="h-3.5 w-3.5" strokeWidth={2} />
          ) : (
            <Lightbulb className="h-3.5 w-3.5" strokeWidth={2} />
          )}
        </button>
        <button
          onClick={onEdit}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <button
          onClick={onDelete}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
    </li>
  );
}

// --- Page ---

export function ActivitiesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Activity | undefined>();
  const [deleting, setDeleting] = useState<Activity | null>(null);
  const [filter, setFilter] = useState<SuggestFilter>("all");

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

  function openCreate() {
    setEditing(undefined);
    setModalOpen(true);
  }

  function openEdit(a: Activity) {
    setEditing(a);
    setModalOpen(true);
  }

  const mutedCount = activities.filter(
    (a) => a.excludeFromRecommendations,
  ).length;
  const counts: Record<SuggestFilter, number> = {
    all: activities.length,
    suggested: activities.length - mutedCount,
    muted: mutedCount,
  };

  const visible =
    filter === "all"
      ? activities
      : activities.filter((a) =>
          filter === "muted"
            ? a.excludeFromRecommendations
            : !a.excludeFromRecommendations,
        );

  // Group by goal
  const byGoal = new Map<string | null, Activity[]>();
  byGoal.set(null, []);
  for (const g of goals.filter((g) => g.status !== "closed"))
    byGoal.set(g.id, []);
  for (const a of visible) {
    const key = a.goalId ?? null;
    if (!byGoal.has(key)) byGoal.set(key, []);
    byGoal.get(key)!.push(a);
  }

  const goalMap = new Map(goals.map((g) => [g.id, g]));

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Activities"
        action={
          <button
            onClick={openCreate}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-foreground hover:bg-muted transition-colors"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        }
      />

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
              <div>
                <p className="text-sm font-medium text-foreground">
                  No activities yet
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Activities are the types of things you do. Occurrences are the
                  individual scheduled instances.
                </p>
              </div>
              <button
                onClick={openCreate}
                className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted transition-colors"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                New Activity
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex overflow-hidden rounded-md border border-border">
                  {FILTERS.map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => setFilter(value)}
                      className={`border-l border-border px-3 py-1.5 text-xs font-medium transition-colors first:border-l-0 ${
                        filter === value
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {label}
                      <span className="ml-1.5 opacity-60">{counts[value]}</span>
                    </button>
                  ))}
                </div>
                <p className="hidden text-xs text-muted-foreground sm:block">
                  Tap the bulb to mute or unmute suggestions
                </p>
              </div>

              {visible.length === 0 ? (
                <div className="flex flex-col items-center gap-1 py-12 text-center">
                  <p className="text-sm text-foreground">
                    {filter === "muted"
                      ? "No muted activities"
                      : "Every activity is muted"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {filter === "muted"
                      ? "All of your activities can show up in suggestions."
                      : "Nothing can be suggested right now. Unmute an activity to bring suggestions back."}
                  </p>
                </div>
              ) : null}

              {Array.from(byGoal.entries()).map(([goalId, list]) => {
                if (list.length === 0) return null;
                const goal = goalId ? goalMap.get(goalId) : null;
                return (
                  <div key={goalId ?? "__none__"}>
                    <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {goal ? goal.title : "No goal"}
                    </p>
                    <div className="overflow-hidden rounded-lg border border-border">
                      <ul className="divide-y divide-border">
                        {list.map((a) => (
                          <ActivityRow
                            key={a.id}
                            activity={a}
                            onView={() => navigate(`/activities/${a.id}`)}
                            onEdit={() => openEdit(a)}
                            onDelete={() => setDeleting(a)}
                            onToggleSuggestions={() =>
                              suggestionsMutation.mutate({
                                id: a.id,
                                exclude: !a.excludeFromRecommendations,
                              })
                            }
                          />
                        ))}
                      </ul>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <ActivityModal
        key={editing?.id ?? "new"}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        activity={editing}
        goals={goals}
        categories={categories}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        loading={deleteMutation.isPending}
        title="Delete activity?"
        message={`"${deleting?.title ?? ""}" and all of its occurrences will be permanently deleted. This cannot be undone.`}
      />
    </div>
  );
}
