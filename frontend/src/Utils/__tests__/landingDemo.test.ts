import { describe, it, expect } from "vitest";
import {
  applyAction, capacityBand, capacityFor, clockLabel, closeOpenForRender, durationLabel, hourToIso,
  hoursRemaining, hoursWorked, nextAction, personCapacity, statusText, sweep,
} from "Utils/landingDemo";
import { buildSampleDay } from "Utils/landingSample";
import { calculateSchedule } from "Utils/scheduler";

const sample = () => buildSampleDay(new Date("2026-03-11T06:00:00Z"));
const last = (t: { task_sessions?: { start_time: string; end_time?: string; status?: string }[] }) => t.task_sessions![t.task_sessions!.length - 1];
const byId = (tasks: ReturnType<typeof sample>["tasks"], id: string) => tasks.find((t) => t.id === id)!;

describe("landing demo rules", () => {
  it("cycles pick, hold, resume and stops at done", () => {
    const { tasks } = sample();
    expect(nextAction(byId(tasks, "t06"))).toBe("pick");
    expect(nextAction(byId(tasks, "t03"))).toBe("hold");
    expect(nextAction(byId(tasks, "t05"))).toBe("resume");
    expect(nextAction(byId(tasks, "t01"))).toBeNull();
    expect(statusText(byId(tasks, "t05"))).toBe("on hold");
  });

  it("picking a task auto-holds the person's other open session, like start_new_session", () => {
    const s = sample();
    const at = hourToIso(s.dayStart, 15);
    const r = applyAction(s.tasks, "t05", "resume", at);
    expect(r.autoHeld).toEqual(["t03"]);
    const held = byId(r.tasks, "t03");
    expect(held.task_status).toBe("on-hold");
    expect(last(held)).toMatchObject({ end_time: at, status: "on-hold" });
    const resumed = byId(r.tasks, "t05");
    expect(resumed.task_status).toBe("in-progress");
    expect(last(resumed)).toEqual({ start_time: at });
    // Other people's work is untouched.
    expect(byId(r.tasks, "t04").task_status).toBe("in-progress");
  });

  it("hold and done close the open session", () => {
    const s = sample();
    const at = hourToIso(s.dayStart, 15);
    const held = applyAction(s.tasks, "t04", "hold", at).tasks;
    expect(byId(held, "t04").task_sessions!.every((x) => x.end_time)).toBe(true);
    const done = applyAction(held, "t04", "done", hourToIso(s.dayStart, 16)).tasks;
    expect(byId(done, "t04")).toMatchObject({ task_status: "done", completed_at: hourToIso(s.dayStart, 16) });
  });

  it("the sweep backlogs unstarted work past due and auto-holds open sessions at 19:00", () => {
    const s = sample();
    const mid = sweep(s.tasks, s.dayStart, 15.6);
    expect(mid.backlogged).toEqual(["t07"]);
    expect(mid.autoHeld).toEqual([]);
    const eod = sweep(mid.tasks, s.dayStart, 19);
    expect(eod.autoHeld.sort()).toEqual(["t03", "t04", "t12", "t14"]);
    expect(eod.backlogged).toEqual(["t06"]);
    expect(last(byId(eod.tasks, "t03")).end_time).toBe(hourToIso(s.dayStart, 19));
    // On-hold work is left alone even when it has a past due date.
    expect(byId(eod.tasks, "t05").task_status).toBe("on-hold");
  });

  it("logged and remaining time come from sessions", () => {
    const s = sample();
    const now = hourToIso(s.dayStart, 14.25);
    expect(hoursWorked(byId(s.tasks, "t03"), now)).toBeCloseTo(1.25 + 0.5);
    expect(hoursRemaining(byId(s.tasks, "t03"), now)).toBeCloseTo(6 - 1.75);
  });

  it("capacity mirrors the API: two-day bin-pack, bands at 70 and 100, worst day wins", () => {
    expect(capacityFor(3, 2)).toEqual({ days: [55.6, 0], status: "available" });
    expect(capacityFor(5, 3).status).toBe("at_capacity");
    expect(capacityFor(4, 16)).toEqual({ days: [100, 122.2], status: "over_capacitated" });
    expect([capacityBand(69.9), capacityBand(70), capacityBand(100), capacityBand(100.1)]).toEqual([
      "available", "at_capacity", "at_capacity", "over_capacitated",
    ]);
    const s = sample();
    // Deniz: 3h20m worked by 14:20 plus the unstarted 3h billing page.
    const deniz = personCapacity(s.tasks, "QB0009", hourToIso(s.dayStart, 14 + 1 / 3));
    expect(deniz.status).toBe("at_capacity");
    const backlogged = sweep(s.tasks, s.dayStart, 16).tasks;
    expect(personCapacity(backlogged, "QB0009", hourToIso(s.dayStart, 16)).status).toBe("available");
  });

  it("open sessions render up to the sample clock through the real calculateSchedule", () => {
    const s = sample();
    const now = 14.5;
    const schedule = calculateSchedule(closeOpenForRender(s.tasks, hourToIso(s.dayStart, now)), s.developers, s.config, s.dayStart, { actualOnly: true });
    const mira = schedule.QB0004.filter((b) => b.date === s.dateKey);
    expect(mira.map((b) => [b.taskId, b.startTime, b.endTime])).toEqual([
      ["t01", 10, 11.75], ["t05", 11.75, 12.25], ["t03", 12.25, 13.5], ["t03", 13.75, 14.5],
    ]);
  });

  it("formats clocks and durations", () => {
    expect(clockLabel(14 + 1 / 3)).toBe("14:20");
    expect(clockLabel(9.999)).toBe("10:00");
    expect(durationLabel(0.5)).toBe("30m");
    expect(durationLabel(2)).toBe("2h");
    expect(durationLabel(1 + 50 / 60)).toBe("1h 50m");
  });
});
