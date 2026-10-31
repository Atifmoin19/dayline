import { CapacityDay, CapacityEmployee, CapacityStatus, CapacitySummary, Employee } from "types";

/**
 * Pure helpers for the Organization Resource View (capacity cards, availability table,
 * saturation heatmap, efficiency gauge). Kept dependency-free and side-effect-free so they're
 * easy to unit test independently of any RTK Query / Chakra rendering.
 */

// ── Capacity bar (next-48h) ──────────────────────────────────────────────────────────────

/** Visual bar width for one day's utilization, capped at 100 so an over-capacitated day
 * (>100%) never overflows its container. The true (uncapped) percentage is still shown via
 * `formatUtilizationLabel` — only the bar's *width* is clamped, not the number the user reads. */
export const capacityBarWidthPct = (day: Pick<CapacityDay, "utilization_pct">): number => {
  const pct = Number(day?.utilization_pct) || 0;
  return Math.max(0, Math.min(100, Math.round(pct)));
};

/** Human label for a utilization percentage, e.g. "132%". Never negative, never a decimal. */
export const formatUtilizationLabel = (pct: number): string =>
  `${Math.max(0, Math.round(Number(pct) || 0))}%`;

// ── Status → color (traffic-light semantics, consistent with the app's existing
// red/amber/green-for-status convention — see TaskListingView's STATUS_META). ────────────────

export const CAPACITY_STATUS_COLOR: Record<CapacityStatus, string> = {
  available: "green.500",
  at_capacity: "yellow.500",
  over_capacitated: "red.500",
};

export const CAPACITY_STATUS_LABEL: Record<CapacityStatus, string> = {
  available: "Available",
  at_capacity: "At Capacity",
  over_capacitated: "Over-capacitated",
};

export const capacityStatusColor = (status?: string): string =>
  CAPACITY_STATUS_COLOR[(status as CapacityStatus) ?? "available"] || "neutral.400";

export const capacityStatusLabel = (status?: string): string =>
  CAPACITY_STATUS_LABEL[(status as CapacityStatus) ?? "available"] || status || "—";

// ── Saturation heatmap color scale ───────────────────────────────────────────────────────
// 5 stops, low → high utilization. Every hex below is reused verbatim from elsewhere in the
// app's palette (Styles/index.ts's brand scale, reports.tsx's STATUS_COLORS, Utils/priority.ts's
// severity hexes) — no new colors are introduced for this view.
export const HEATMAP_STOPS: { max: number; color: string }[] = [
  { max: 40, color: "#e2e8f0" }, // neutral.200 — quiet
  { max: 70, color: "#93b4fd" }, // brand.300 — comfortable (below the backend's 70% "available" line)
  { max: 90, color: "#eab308" }, // amber (reports.tsx STATUS_COLORS "on-hold") — approaching capacity
  { max: 110, color: "#f97316" }, // orange (reports.tsx STATUS_COLORS "backlog") — at/near the 100% line
  { max: Infinity, color: "#dc2626" }, // red (Utils/priority.ts P0) — over-capacitated
];

/** Maps a utilization percentage to one of the 5 HEATMAP_STOPS colors. */
export const heatmapColor = (pct: number): string => {
  const value = Number(pct) || 0;
  const stop = HEATMAP_STOPS.find((s) => value < s.max);
  return (stop ?? HEATMAP_STOPS[HEATMAP_STOPS.length - 1]).color;
};

// ── Resource Efficiency Index ─────────────────────────────────────────────────────────────
//
// Formula (documented here since there's no product spec for it yet):
//   REI = round( avgUtilization * 0.7 + (100 - overCapacitatedRatio * 100) * 0.3 )
//   clamped to [0, 100]
//
// Rationale: average utilization alone rewards overloading people (100% avg looks "perfect"
// even if everyone is burning out), and the over-capacitated ratio alone ignores whether
// anyone is actually being productively used. Blending them means a team that's well-utilized
// AND not overcommitting anyone scores highest; a team that's "efficient" only because a chunk
// of it is over-capacitated gets pulled down by the second term. 70/30 weighting keeps
// utilization as the primary signal (it's the more direct measure of resource efficiency)
// while still meaningfully penalizing unsustainable overcommitment.
export const computeEfficiencyIndex = (summary: Pick<CapacitySummary, "avg_utilization_pct" | "over_capacitated_count" | "total_employees">): number => {
  if (!summary || !summary.total_employees) return 0;
  const overRatio = summary.over_capacitated_count / summary.total_employees;
  const raw = summary.avg_utilization_pct * 0.7 + (100 - overRatio * 100) * 0.3;
  return Math.max(0, Math.min(100, Math.round(raw)));
};

// ── Department filter ────────────────────────────────────────────────────────────────────

export const ALL_DEPARTMENTS = "all";

/** Enriched capacity row — the /capacity employee joined with the /user directory entry
 * sharing the same emp_id, since /capacity's response has no emp_department/profile_pic of
 * its own (see main.py's _capacity_for_employee — deliberately lean). */
export interface EnrichedCapacityEmployee extends CapacityEmployee {
  emp_department?: string;
  profile_pic?: string;
}

/** Joins /capacity's employees with the /user directory by emp_id so department/avatar data
 * (which /capacity doesn't carry) is available for filtering/display. Unmatched employees
 * (directory not loaded yet, or a race) simply have no department/photo — never dropped. */
export const enrichCapacityEmployees = (
  employees: CapacityEmployee[],
  directory: Employee[],
): EnrichedCapacityEmployee[] => {
  const byId = new Map(directory.map((d) => [d.emp_id, d]));
  return employees.map((e) => {
    const match = byId.get(e.emp_id);
    return { ...e, emp_department: match?.emp_department, profile_pic: match?.profile_pic };
  });
};

/** Sorted, de-duplicated department list found across the given rows (falsy/blank departments
 * excluded — those employees still show up under "All Departments"). */
export const getDepartmentOptions = (rows: EnrichedCapacityEmployee[]): string[] => {
  const set = new Set<string>();
  rows.forEach((r) => {
    if (r.emp_department && r.emp_department.trim()) set.add(r.emp_department.trim());
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
};

/** Client-side department filter. `ALL_DEPARTMENTS` (or any falsy value) returns every row. */
export const filterByDepartment = <T extends { emp_department?: string }>(
  rows: T[],
  department: string,
): T[] => {
  if (!department || department === ALL_DEPARTMENTS) return rows;
  return rows.filter((r) => r.emp_department === department);
};

// ── Per-employee timezone (heatmap grouping/labeling) ────────────────────────────────────
// GET /capacity resolves and returns each employee's own IANA timezone (see main.py's
// _resolve_employee_tz_name / _capacity_for_employee) — every row's day-boundary math is
// already computed in THEIR timezone, not one org-wide clock. The helpers below let the UI
// actually surface that: a short label for a compact badge, and a stable group-by-timezone
// for the Team Saturation Heatmap so it reads as "across timezones" instead of a flat list.

const UNKNOWN_TIMEZONE = "Unknown";

/** Short, human-friendly label for an IANA timezone name, e.g. "Asia/Kolkata" -> "Kolkata",
 * "Pacific/Honolulu" -> "Honolulu", "UTC" -> "UTC". Falls back to "Unknown" for a
 * missing/blank value — defensive only; GET /capacity always sends a real value. */
export const formatTimezoneLabel = (tz?: string | null): string => {
  if (!tz || !tz.trim()) return UNKNOWN_TIMEZONE;
  const parts = tz.trim().split("/");
  return parts[parts.length - 1].replace(/_/g, " ");
};

export interface TimezoneGroup<T> {
  timezone: string; // raw IANA name (or UNKNOWN_TIMEZONE), used as the section heading
  rows: T[];
}

/** Groups rows by their resolved `timezone`, sorted alphabetically by IANA name so the
 * heatmap's section order is stable across renders. Employees within a group keep their
 * incoming relative order (i.e. this is a stable partition, not a full re-sort of rows). A
 * missing/blank timezone buckets under "Unknown" rather than being dropped. */
export const groupRowsByTimezone = <T extends { timezone?: string | null }>(
  rows: T[],
): TimezoneGroup<T>[] => {
  const order: string[] = [];
  const byTz = new Map<string, T[]>();
  rows.forEach((r) => {
    const tz = r.timezone && r.timezone.trim() ? r.timezone.trim() : UNKNOWN_TIMEZONE;
    const bucket = byTz.get(tz);
    if (bucket) {
      bucket.push(r);
    } else {
      byTz.set(tz, [r]);
      order.push(tz);
    }
  });
  return order
    .sort((a, b) => a.localeCompare(b))
    .map((timezone) => ({ timezone, rows: byTz.get(timezone) as T[] }));
};
