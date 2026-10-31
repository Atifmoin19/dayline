import { AtRiskTask, Employee, RiskLevel, Task } from "types";
import { CAPACITY_STATUS_COLOR } from "Utils/capacity";

/**
 * Pure helpers for the AI Insight panel's two deterministic (NO Gemini) sections —
 * at-risk tasks and rebalance suggestions. Kept dependency-free/side-effect-free, same
 * rationale as Utils/capacity.ts: easy to unit test without RTK Query/Chakra rendering.
 *
 * Color semantics are deliberately reused from CAPACITY_STATUS_COLOR rather than a new
 * parallel scale — a "high" risk task/an overloaded employee is the same red as
 * `over_capacitated` on the capacity view, a "medium" risk task is the same amber as
 * `at_capacity`, and an idle rebalance target is the same green as `available`.
 */

export const RISK_LEVEL_COLOR: Record<RiskLevel, string> = {
  medium: CAPACITY_STATUS_COLOR.at_capacity,
  high: CAPACITY_STATUS_COLOR.over_capacitated,
};

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  medium: "Medium risk",
  high: "High risk",
};

export const riskLevelColor = (level?: string): string =>
  RISK_LEVEL_COLOR[level as RiskLevel] || "neutral.400";

export const riskLevelLabel = (level?: string): string =>
  RISK_LEVEL_LABEL[level as RiskLevel] || level || "—";

// Rebalance pairs reuse the exact same two capacity-status colors, not new ones.
export const REBALANCE_OVERLOADED_COLOR = CAPACITY_STATUS_COLOR.over_capacitated;
export const REBALANCE_IDLE_COLOR = CAPACITY_STATUS_COLOR.available;

/** High-risk first; stable otherwise (keeps the backend's own ordering within each bucket
 * rather than re-sorting on anything else). */
export const sortAtRiskTasks = (items: AtRiskTask[] = []): AtRiskTask[] =>
  [...items].sort((a, b) => {
    if (a.risk_level === b.risk_level) return 0;
    return a.risk_level === "high" ? -1 : 1;
  });

/** emp_id -> display name via the already-loaded directory (state.scheduler.developers) —
 * never triggers a redundant fetch. Falls back to the raw emp_id (never blank/dropped) if
 * the directory hasn't loaded yet or doesn't contain this employee. */
export const resolveEmpName = (empId: string, directory: Employee[] = []): string =>
  directory.find((d) => d.emp_id === empId)?.emp_name || empId;

/** Matches an at-risk task's `task_id` against the already-scoped Redux task list
 * (state.scheduler.tasks) so a click can open the real Task object via useTaskDetail()
 * without a redundant fetch — the insights payload only carries id/name, not the full task. */
export const findLocalTask = (taskId: string, tasks: Task[] = []): Task | undefined =>
  tasks.find((t) => String(t.id) === String(taskId));
