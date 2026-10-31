/**
 * Shared status vocabulary + display meta for Epics. Mirrors the Task status set/colors
 * (see TaskListingView's local STATUS_META) so an epic's own status badge reads consistently
 * with story status elsewhere in the app — kept as its own copy here (rather than importing
 * from TaskListingView, which isn't exported and is off-limits to edit right now) since Epic
 * status is a separate free-form field, not literally a Task's `task_status`.
 */
export interface EpicStatusOption {
  value: string;
  label: string;
}

export const EPIC_STATUS_OPTIONS: EpicStatusOption[] = [
  { value: "backlog", label: "Backlog" },
  { value: "todo", label: "To Do" },
  { value: "in-progress", label: "In Progress" },
  { value: "on-hold", label: "On Hold" },
  { value: "done", label: "Done" },
];

const EPIC_STATUS_META: Record<string, { color: string; label: string }> = {
  "in-progress": { color: "blue.500", label: "In Progress" },
  todo: { color: "neutral.400", label: "To Do" },
  backlog: { color: "orange.400", label: "Backlog" },
  "on-hold": { color: "yellow.400", label: "On Hold" },
  done: { color: "green.500", label: "Done" },
  completed: { color: "green.500", label: "Done" },
};

/** Dot color + display label for an epic status value; falls back gracefully for an unset
 * or unrecognized status instead of throwing/blanking. */
export const epicStatusMeta = (status?: string): { color: string; label: string } =>
  EPIC_STATUS_META[(status || "").toLowerCase()] || {
    color: "neutral.300",
    label: status || "—",
  };
