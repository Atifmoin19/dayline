import { parseDurationToHours } from "Utils/common";
import { Task, TaskSession } from "types";

/**
 * Pure, client-side model of the rules the Dayline backend applies to tasks, used by the
 * landing page's interactive timeline. Times are hours of the sample day (14.5 = 14:30),
 * turned into instants from the day's business-timezone midnight so the app's own
 * `calculateSchedule` can draw them.
 *
 * Mirrors, in order of appearance:
 *  - main.py `start_new_session`: picking or resuming a task auto-holds the person's other
 *    open session (one active session per person).
 *  - tasks_celery.py `sweep_overdue_tasks`: an open session at or past end of business day is
 *    closed at the cap and the task put on hold; a task with no open session past its due
 *    date moves to the backlog.
 *  - main.py `_capacity_for_employee` / `_capacity_status`: worked time + unstarted work,
 *    bin-packed over a two-day horizon against the business day; <70% available,
 *    70-100% at capacity, >100% over capacity.
 */

export type DemoAction = "pick" | "hold" | "resume" | "done";

export const BUSINESS_START_HOUR = 10;
export const BUSINESS_END_HOUR = 19;
export const BUSINESS_DAY_HOURS = BUSINESS_END_HOUR - BUSINESS_START_HOUR;

export const hourToIso = (dayStart: Date, hour: number): string =>
  new Date(dayStart.getTime() + hour * 3600e3).toISOString();

export const isoToHour = (dayStart: Date, iso: string): number =>
  (new Date(iso).getTime() - dayStart.getTime()) / 3600e3;

const openSession = (t: Task): TaskSession | undefined => t.task_sessions?.find((s) => !s.end_time);

/** The one action a click performs next: todo/backlog -> pick, in progress -> hold, held -> resume. */
export const nextAction = (task: Task): DemoAction | null => {
  switch (task.task_status) {
    case "todo":
    case "backlog":
      return "pick";
    case "in-progress":
      return "hold";
    case "on-hold":
      return "resume";
    default:
      return null;
  }
};

const closeOpen = (task: Task, endIso: string, status: string): Task => ({
  ...task,
  task_sessions: (task.task_sessions || []).map((s) => (s.end_time ? s : { ...s, end_time: endIso, status })),
});

export interface ActionResult {
  tasks: Task[];
  /** Other tasks of the same person that were auto-held by a pick/resume. */
  autoHeld: string[];
}

/** Apply a pick/hold/resume/done to one task at `atIso`, like the API does. */
export const applyAction = (tasks: Task[], taskId: string, action: DemoAction, atIso: string): ActionResult => {
  const target = tasks.find((t) => t.id === taskId);
  if (!target) return { tasks, autoHeld: [] };
  const autoHeld: string[] = [];

  const next = tasks.map((t) => {
    if (t.id === taskId) {
      if (action === "pick" || action === "resume") {
        if (openSession(t)) return { ...t, task_status: "in-progress" };
        return {
          ...t,
          task_status: "in-progress",
          task_assigned_date: atIso,
          task_updated_at: atIso,
          task_sessions: [...(t.task_sessions || []), { start_time: atIso }],
        };
      }
      if (action === "hold") return { ...closeOpen(t, atIso, "on-hold"), task_status: "on-hold", task_updated_at: atIso };
      return { ...closeOpen(t, atIso, "completed"), task_status: "done", completed_at: atIso, task_updated_at: atIso };
    }
    // One active session per person: starting work holds whatever else they had open.
    if ((action === "pick" || action === "resume") && t.task_assigned_to === target.task_assigned_to && openSession(t)) {
      autoHeld.push(t.id);
      return { ...closeOpen(t, atIso, "on-hold"), task_status: "on-hold", task_updated_at: atIso };
    }
    return t;
  });
  return { tasks: next, autoHeld };
};

export interface SweepResult {
  tasks: Task[];
  autoHeld: string[];
  backlogged: string[];
}

const CLOSED = new Set(["done", "completed", "backlog", "on-hold"]);

/** One overdue sweep at `nowHour` (the backend runs this every 60 s). */
export const sweep = (tasks: Task[], dayStart: Date, nowHour: number, endHour = BUSINESS_END_HOUR): SweepResult => {
  const autoHeld: string[] = [];
  const backlogged: string[] = [];
  const next = tasks.map((t) => {
    if (CLOSED.has(t.task_status || "")) return t;
    if (openSession(t)) {
      if (nowHour < endHour) return t;
      autoHeld.push(t.id);
      return { ...closeOpen(t, hourToIso(dayStart, endHour), "on-hold"), task_status: "on-hold" };
    }
    if (t.task_due_date && nowHour > isoToHour(dayStart, t.task_due_date)) {
      backlogged.push(t.id);
      return { ...t, task_status: "backlog" };
    }
    return t;
  });
  return { tasks: next, autoHeld, backlogged };
};

/** For drawing: open sessions end "now" on the sample clock instead of the visitor's clock. */
export const closeOpenForRender = (tasks: Task[], nowIso: string): Task[] =>
  tasks.map((t) => (openSession(t) ? closeOpen(t, nowIso, "") : t));

/** Hours logged across all sessions, an open one counted up to `nowIso`. */
export const hoursWorked = (task: Task, nowIso: string): number =>
  (task.task_sessions || []).reduce((sum, s) => {
    const end = new Date(s.end_time || nowIso).getTime();
    return sum + Math.max(0, end - new Date(s.start_time).getTime()) / 3600e3;
  }, 0);

export const hoursRemaining = (task: Task, nowIso: string): number =>
  Math.max(0, parseDurationToHours(task.task_duration || 0) - hoursWorked(task, nowIso));

export type CapacityBand = "available" | "at_capacity" | "over_capacitated";

export const capacityBand = (pct: number): CapacityBand =>
  pct > 100 ? "over_capacitated" : pct < 70 ? "available" : "at_capacity";

export interface CapacityResult {
  /** Utilization per day of the horizon, today first. */
  days: number[];
  /** Band of the worst day, as the API reports it. */
  status: CapacityBand;
}

/** `_capacity_for_employee`: today's worked hours plus never-started work, over `days` days. */
export const capacityFor = (workedToday: number, unstartedHours: number, available = BUSINESS_DAY_HOURS, days = 2): CapacityResult => {
  let left = unstartedHours;
  const pcts: number[] = [];
  for (let i = 0; i < days; i++) {
    const last = i === days - 1;
    const headroom = i === 0 ? Math.max(0, available - workedToday) : available;
    const allocated = last ? left : Math.min(left, headroom);
    left -= allocated;
    const committed = (i === 0 ? workedToday : 0) + allocated;
    pcts.push(Math.round((committed / available) * 1000) / 10);
  }
  return { days: pcts, status: capacityBand(Math.max(...pcts)) };
};

/** Capacity of one person from their tasks at `nowIso` (sessions are all on the sample day). */
export const personCapacity = (tasks: Task[], empId: string, nowIso: string): CapacityResult => {
  const mine = tasks.filter((t) => t.task_assigned_to === empId);
  const worked = mine.reduce((s, t) => s + hoursWorked(t, nowIso), 0);
  // Same "closed" set as the API's capacity math: done, completed, backlog (on-hold still counts).
  const unstarted = mine
    .filter((t) => !["done", "completed", "backlog"].includes(t.task_status || "") && !(t.task_sessions || []).length)
    .reduce((s, t) => s + parseDurationToHours(t.task_duration || 0), 0);
  return capacityFor(worked, unstarted);
};

/** "14:05" from 14.083 */
export const clockLabel = (hour: number): string => {
  const total = Math.round(hour * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

/** "2h 10m" */
export const durationLabel = (hours: number): string => {
  const m = Math.round(hours * 60);
  if (m < 60) return `${m}m`;
  return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`;
};

const STATUS_TEXT: Record<string, string> = {
  "in-progress": "in progress",
  "on-hold": "on hold",
  done: "done",
  todo: "to do",
  backlog: "in the backlog",
};

/** "in progress", "on hold", ... */
export const statusText = (t?: Task): string => STATUS_TEXT[t?.task_status || ""] || t?.task_status || "";
