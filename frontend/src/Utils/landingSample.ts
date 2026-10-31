import { BUSINESS_TZ, getLocalDateKey } from "Utils/scheduler";
import { CompanyConfig, Employee, Task } from "types";

/**
 * Sample day for the landing page timelines. People and tasks come from the demo seed
 * (Quillbrook Labs, backend/seed/quillbrook_labs.json), so what a visitor plays with here
 * is what they meet after "Try the demo".
 */
export interface SampleDay {
  developers: Employee[];
  tasks: Task[];
  config: CompanyConfig;
  dayStart: Date; // business-timezone midnight of the sample day
  dateKey: string;
  /** Where the sample clock starts, in hours of the day. */
  startClock: number;
}

/** Midnight of `ref`'s calendar day in `tz`, as an instant. */
const zonedMidnight = (ref: Date, tz: string): Date => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(ref).map((p) => [p.type, p.value]),
  );
  const sinceMidnight = ((Number(parts.hour) % 24) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000;
  return new Date(ref.getTime() - sinceMidnight - ref.getMilliseconds());
};

const person = (emp_id: string, emp_name: string, emp_designation: string): Employee => ({
  emp_id, emp_name, emp_designation, emp_email: `${emp_id.toLowerCase()}@quillbrook.example`,
});

export const SAMPLE_START_CLOCK = 14 + 20 / 60;

export const buildSampleDay = (ref: Date = new Date(), tz: string = BUSINESS_TZ): SampleDay => {
  const dayStart = zonedMidnight(ref, tz);
  const at = (h: number) => new Date(dayStart.getTime() + h * 3600e3).toISOString();
  // Closed session, or an open one (still running) when `to` is omitted.
  const s = (from: number, to?: number, status?: string) =>
    to === undefined ? { start_time: at(from) } : { start_time: at(from), end_time: at(to), status };

  const developers = [
    person("QB0004", "Mira Okafor", "Senior Software Engineer"),
    person("QB0005", "Tomas Lindqvist", "Software Engineer"),
    person("QB0011", "Juno Halvorsen", "Senior QA Engineer"),
    person("QB0009", "Deniz Albrecht", "Associate Software Engineer"),
  ];
  const task = (
    id: string, name: string, to: string, priority: string, status: string, duration: string,
    sessions: Task["task_sessions"], due?: number,
  ): Task => ({
    id, ticket_id: `T-${id.slice(1).padStart(5, "0")}`, task_name: name, task_assigned_to: to,
    task_priority: priority, task_status: status, task_duration: duration,
    task_assigned_date: at(9),
    task_due_date: due === undefined ? undefined : at(due),
    task_sessions: sessions,
  });

  const tasks = [
    task("t01", "Design invoice data model", "QB0004", "P1", "done", "02:00", [s(10, 11.75, "completed")]),
    task("t05", "Proration: API endpoint", "QB0004", "P1", "on-hold", "04:00", [s(11.75, 12.25, "on-hold")]),
    task("t03", "Plan change proration", "QB0004", "P0", "in-progress", "06:00", [s(12.25, 13.5, "on-hold"), s(13.75)]),
    task("t02", "Stripe-style webhook receiver", "QB0005", "P1", "done", "03:00", [s(10.25, 12.75, "completed")]),
    task("t04", "Proration: unit tests for edge dates", "QB0005", "P2", "in-progress", "03:00", [s(13.5)]),
    task("t06", "Invoice PDF rendering", "QB0005", "P2", "todo", "05:00", [], 17),
    task("t12", "Flaky checkout test investigation", "QB0011", "P1", "in-progress", "03:00", [s(10, 11.5, "on-hold"), s(14)]),
    task("t13", "Regression plan for billing launch", "QB0011", "P1", "on-hold", "04:00", [s(11.75, 13.5, "on-hold")]),
    task("t19", "Dark mode color tokens", "QB0009", "P2", "done", "02:00", [s(10.5, 12, "completed")]),
    task("t14", "New bottom navigation", "QB0009", "P1", "in-progress", "06:00", [s(12.5)]),
    task("t07", "Billing settings page", "QB0009", "P2", "todo", "03:00", [], 15.5),
  ];
  return {
    developers, tasks, config: { startHour: 10, endHour: 19 }, dayStart,
    dateKey: getLocalDateKey(new Date(dayStart.getTime() + 12 * 3600e3)),
    startClock: SAMPLE_START_CLOCK,
  };
};
