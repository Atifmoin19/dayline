import { useCallback, useEffect, useState } from "react";

export interface SavedView {
  id: string;
  name: string;
  search: string;
  statusFilter: string;
  priorityFilter: string;
  // Timeline/Week "team view" (scale-gaps-plan.md §B.2): the member search-filter selection
  // (a cross-functional set of emp_ids, not an org-tree subtree) to re-apply. Optional — the
  // Task List's saved views never set this, and Timeline/Week's saved views don't use
  // search/statusFilter/priorityFilter above (those stay required only for the Task List's
  // existing shape; Timeline/Week callers pass harmless defaults for them).
  memberIds?: string[];
}

type ViewFilters = Pick<SavedView, "search" | "statusFilter" | "priorityFilter"> & {
  memberIds?: string[];
};

// `namespace` keeps unrelated saved-view stores from mixing in the same list — e.g. Timeline/
// Week's "team views" (member-id sets) are a different shape/purpose than the Task List's
// search/status/priority presets, so they're saved under their own namespaced key rather than
// appearing in each other's toolbar. Omitting it preserves the original (Task List) key exactly.
const keyFor = (empId?: string, namespace?: string) =>
  `taskboard.savedViews${namespace ? `.${namespace}` : ""}.${empId || "anon"}`;

const load = (empId?: string, namespace?: string): SavedView[] => {
  try {
    const raw = localStorage.getItem(keyFor(empId, namespace));
    return raw ? (JSON.parse(raw) as SavedView[]) : [];
  } catch {
    return [];
  }
};

const persist = (empId: string | undefined, namespace: string | undefined, views: SavedView[]) => {
  try {
    localStorage.setItem(keyFor(empId, namespace), JSON.stringify(views));
  } catch {
    // localStorage unavailable (private mode / quota) — saved views just won't persist.
  }
};

/**
 * Named filter presets, persisted to localStorage per user. Frontend-only — no backend
 * involved, so it works offline and needs no migration.
 *
 * Used two ways today:
 * - Task List toolbar (no `namespace`): presets of search + status + priority.
 * - Timeline/Week "team views" (`namespace: "timeline"`): a named set of `memberIds` — a
 *   cross-functional group of people that isn't limited to an org-tree subtree.
 */
export const useSavedViews = (empId?: string, namespace?: string) => {
  const [views, setViews] = useState<SavedView[]>(() => load(empId, namespace));

  // Re-load if the signed-in user (or namespace) changes (e.g. logout/login as someone else
  // in the same tab).
  useEffect(() => {
    setViews(load(empId, namespace));
  }, [empId, namespace]);

  const saveView = useCallback(
    (name: string, filters: ViewFilters) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setViews((prev) => {
        const next = [
          ...prev.filter((v) => v.name.toLowerCase() !== trimmed.toLowerCase()),
          { id: `${Date.now()}`, name: trimmed, ...filters },
        ];
        persist(empId, namespace, next);
        return next;
      });
    },
    [empId, namespace],
  );

  const deleteView = useCallback(
    (id: string) => {
      setViews((prev) => {
        const next = prev.filter((v) => v.id !== id);
        persist(empId, namespace, next);
        return next;
      });
    },
    [empId, namespace],
  );

  return { views, saveView, deleteView };
};
