import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { calculateSchedule } from "Utils/scheduler";
import { Task, Employee, CompanyConfig } from "types";

// BUSINESS_TZ defaults to Asia/Kolkata (UTC+5:30) — all UTC fixture timestamps below are
// chosen so the +5:30 shift lands on clean, easy-to-assert hour boundaries.

const dev1: Employee = {
  emp_id: "dev1",
  emp_name: "Dev One",
  emp_email: "dev1@example.com",
  emp_designation: "Software Engineer",
};

const config: CompanyConfig = { startHour: 9, endHour: 18 };

const baseTask = (overrides: Partial<Task>): Task => ({
  id: "t",
  task_name: "task",
  task_assigned_to: "dev1",
  ...overrides,
});

describe("calculateSchedule — actualOnly mode (session-derived segments)", () => {
  it("turns a single completed session into one completed block, in business-tz hours", () => {
    const tasks: Task[] = [
      baseTask({
        id: "t1",
        task_status: "done",
        completed_at: "2026-07-20T06:00:00Z",
        task_sessions: [
          {
            start_time: "2026-07-20T04:00:00Z", // 09:30 IST
            end_time: "2026-07-20T06:00:00Z", // 11:30 IST
            status: "completed",
          },
        ],
      }),
    ];

    const schedule = calculateSchedule(tasks, [dev1], config, new Date(), { actualOnly: true });
    const blocks = schedule["dev1"];

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      taskId: "t1",
      date: "2026-07-20",
      status: "completed",
      isSession: true,
    });
    expect(blocks[0].startTime).toBeCloseTo(9.5, 5);
    expect(blocks[0].endTime).toBeCloseTo(11.5, 5);
  });

  it("merges contiguous same-status same-day sessions (gap < 1 min) into a single block", () => {
    const tasks: Task[] = [
      baseTask({
        id: "t1",
        task_status: "done",
        completed_at: "2026-07-20T07:00:00Z",
        task_sessions: [
          {
            start_time: "2026-07-20T04:00:00Z", // 09:30 IST
            end_time: "2026-07-20T05:00:00Z", // 10:30 IST
            status: "completed",
          },
          {
            // Starts 30s after the previous one ends — should merge.
            start_time: "2026-07-20T05:00:30Z",
            end_time: "2026-07-20T07:00:00Z", // 12:30 IST
            status: "completed",
          },
        ],
      }),
    ];

    const schedule = calculateSchedule(tasks, [dev1], config, new Date(), { actualOnly: true });
    const blocks = schedule["dev1"];

    expect(blocks).toHaveLength(1);
    expect(blocks[0].startTime).toBeCloseTo(9.5, 5);
    expect(blocks[0].endTime).toBeCloseTo(12.5, 5);
  });

  it("does NOT merge two sessions on the same day separated by a real gap (worked on something else)", () => {
    const tasks: Task[] = [
      baseTask({
        id: "t1",
        task_status: "done",
        completed_at: "2026-07-20T09:00:00Z",
        task_sessions: [
          {
            start_time: "2026-07-20T04:00:00Z", // 09:30 IST
            end_time: "2026-07-20T05:00:00Z", // 10:30 IST
            status: "completed",
          },
          {
            // 30 minutes later — well over the 1-minute merge threshold.
            start_time: "2026-07-20T05:30:00Z",
            end_time: "2026-07-20T09:00:00Z",
            status: "completed",
          },
        ],
      }),
    ];

    const schedule = calculateSchedule(tasks, [dev1], config, new Date(), { actualOnly: true });
    const blocks = schedule["dev1"];

    expect(blocks).toHaveLength(2);
  });

  it("produces no block for a todo/backlog task that hasn't been worked on (actualOnly skips planned simulation)", () => {
    const tasks: Task[] = [baseTask({ id: "t-todo", task_status: "todo" })];

    const schedule = calculateSchedule(tasks, [dev1], config, new Date(), { actualOnly: true });

    expect(schedule["dev1"]).toEqual([]);
  });

  it("never emits a 'planned' status block in actualOnly mode", () => {
    const tasks: Task[] = [
      baseTask({ id: "t-todo", task_status: "todo" }),
      baseTask({
        id: "t-done",
        task_status: "done",
        completed_at: "2026-07-20T06:00:00Z",
        task_sessions: [
          { start_time: "2026-07-20T04:00:00Z", end_time: "2026-07-20T06:00:00Z", status: "completed" },
        ],
      }),
    ];

    const schedule = calculateSchedule(tasks, [dev1], config, new Date(), { actualOnly: true });
    expect(schedule["dev1"].some((b) => b.status === "planned")).toBe(false);
  });

  describe("live (open) sessions", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-20T06:00:00Z")); // "now" = 11:30 IST
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("marks an open session isLive and extends it to the planned remaining duration", () => {
      const tasks: Task[] = [
        baseTask({
          id: "t-live",
          task_status: "in-progress",
          task_duration: "2",
          remaining_seconds: 10800, // 3 hours remaining
          task_sessions: [
            {
              start_time: "2026-07-20T04:00:00Z", // 09:30 IST
              // no end_time => still open/live
              status: "in-progress",
            },
          ],
        }),
      ];

      const schedule = calculateSchedule(tasks, [dev1], config, new Date(), { actualOnly: true });
      const blocks = schedule["dev1"];

      expect(blocks).toHaveLength(1);
      expect(blocks[0].isLive).toBe(true);
      expect(blocks[0].startTime).toBeCloseTo(9.5, 5);
      // elapsed-to-now is 2h (9:30->11:30) but the 3h planned remaining wins: 9.5 + 3 = 12.5
      expect(blocks[0].endTime).toBeCloseTo(12.5, 5);
    });

    it("synthesizes a live block for an in-progress task with corrupt/missing sessions", () => {
      const tasks: Task[] = [
        baseTask({
          id: "t-corrupt",
          task_status: "in-progress",
          task_assigned_date: "2026-07-20T04:00:00Z", // 09:30 IST
          task_duration: "1",
          remaining_seconds: 3600,
          // No task_sessions at all.
        }),
      ];

      const schedule = calculateSchedule(tasks, [dev1], config, new Date(), { actualOnly: true });
      const blocks = schedule["dev1"];

      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toMatchObject({ taskId: "t-corrupt", status: "in-progress", isSession: true, isLive: true });
      expect(blocks[0].startTime).toBeCloseTo(9.5, 5);
    });
  });
});
