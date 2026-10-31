/**
 * Shared display meta for Sprint status. Unlike Epic status (a free-form field the creator
 * picks — see Utils/epicStatus.ts), a Sprint's `status_label` is entirely server-derived from
 * its `start_date`/`end_date` (never stored, never user-editable) — so there's no options list
 * here, just a color/label lookup for the badge.
 */
export interface SprintStatusMeta {
  color: string;
  label: string;
}

const SPRINT_STATUS_META: Record<string, SprintStatusMeta> = {
  upcoming: { color: "neutral.400", label: "Upcoming" },
  active: { color: "blue.500", label: "Active" },
  completed: { color: "green.500", label: "Completed" },
};

/** Dot color + display label for a sprint's `status_label`; falls back gracefully for an
 * unrecognized value instead of throwing/blanking. */
export const sprintStatusMeta = (status?: string): SprintStatusMeta =>
  SPRINT_STATUS_META[(status || "").toLowerCase()] || {
    color: "neutral.300",
    label: status || "—",
  };
