import { describe, it, expect } from "vitest";
import { hasOpenSession, scheduleRefreshKey } from "Utils/scheduleRefresh";
import { Task } from "types";

const idle: Task[] = [
  { id: "a", task_name: "A", task_status: "done", task_sessions: [{ start_time: "2026-03-11T05:00:00Z", end_time: "2026-03-11T06:00:00Z" }] },
  { id: "b", task_name: "B", task_status: "todo", task_sessions: [] },
] as Task[];
const live: Task[] = [
  ...idle,
  { id: "c", task_name: "C", task_status: "in-progress", task_sessions: [{ start_time: "2026-03-11T07:00:00Z" }] },
] as Task[];

describe("scheduleRefreshKey", () => {
  it("detects an open (live) session", () => {
    expect(hasOpenSession(idle)).toBe(false);
    expect(hasOpenSession(live)).toBe(true);
    expect(hasOpenSession([])).toBe(false);
  });

  it("does not change on the minute tick when nothing is live (no 60-day recompute)", () => {
    expect(scheduleRefreshKey(idle, 1, "2026-03-11")).toBe(scheduleRefreshKey(idle, 2, "2026-03-11"));
  });

  it("changes on the tick while a session is live, so the live block keeps growing", () => {
    expect(scheduleRefreshKey(live, 1, "2026-03-11")).not.toBe(scheduleRefreshKey(live, 2, "2026-03-11"));
  });

  it("changes when the calendar day rolls over even with nothing live", () => {
    expect(scheduleRefreshKey(idle, 1, "2026-03-11")).not.toBe(scheduleRefreshKey(idle, 1, "2026-03-12"));
  });
});
