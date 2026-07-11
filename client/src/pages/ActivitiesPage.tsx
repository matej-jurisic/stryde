import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Plus, Pencil, Trash2, Layers } from "lucide-react";
import { activitiesApi, goalsApi, categoriesApi } from "@/lib/api";
import type { Activity } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { CategoryIcon } from "@/components/categories/categoryIcons";
import { PageHeader } from "@/components/layout/PageHeader";
import { ActivityModal } from "@/components/activities/ActivityModal";

const GOAL_TONE: Record<string, "focus" | "active" | "bench" | "neutral"> = {
  focus: "focus",
  active: "active",
  bench: "bench",
  closed: "neutral",
};

// --- Activity row ---

function ActivityRow({
  activity,
  onView,
  onEdit,
  onDelete,
}: {
  activity: Activity;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
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

  const deleteMutation = useMutation({
    mutationFn: (id: string) => activitiesApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["activities"] }),
  });

  function openCreate() {
    setEditing(undefined);
    setModalOpen(true);
  }

  function openEdit(a: Activity) {
    setEditing(a);
    setModalOpen(true);
  }

  // Group by goal
  const byGoal = new Map<string | null, Activity[]>();
  byGoal.set(null, []);
  for (const g of goals.filter((g) => g.status !== "closed"))
    byGoal.set(g.id, []);
  for (const a of activities) {
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
                            onDelete={() => deleteMutation.mutate(a.id)}
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
    </div>
  );
}
