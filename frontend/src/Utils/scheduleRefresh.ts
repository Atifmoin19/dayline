import { Task } from "types";

/** True when any task has a session still running (no end_time yet). */
export const hasOpenSession = (tasks: Task[]): boolean =>
  tasks.some((t) => (t.task_sessions || []).some((s) => !s.end_time));

/**
 * Memo key for the timeline's schedule. The full calculateSchedule run is expensive, and
 * between data changes its output only moves with the clock when a session is live (the
 * open block grows) or the day rolls over (the simulation start date shifts). So the
 * minute tick only participates while something is live.
 */
export const scheduleRefreshKey = (tasks: Task[], tick: number, dayKey: string): string =>
  `${dayKey}|${hasOpenSession(tasks) ? tick : 0}`;
