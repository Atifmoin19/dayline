import { BUSINESS_TZ, getLocalDateKey } from "Utils/scheduler";
import { CompanyConfig, Employee, Task } from "types";

/** Static sample day for the landing page's live-timeline preview (fictional people). */
export interface SampleDay {
  developers: Employee[];
  tasks: Task[];
  config: CompanyConfig;
  dayStart: Date; // business-timezone midnight of the sample day
  dateKey: string;
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

export const buildSampleDay = (ref: Date = new Date(), tz: string = BUSINESS_TZ): SampleDay => {
  const dayStart = zonedMidnight(ref, tz);
  const at = (h: number) => new Date(dayStart.getTime() + h * 3600e3).toISOString();
  const s = (from: number, to: number) => ({ start_time: at(from), end_time: at(to) });

  const developers = [
    person("QB0004", "Mira Okafor", "Senior Software Engineer"),
    person("QB0009", "Deniz Albrecht", "Associate Software Engineer"),
    person("QB0011", "Juno Halvorsen", "Senior QA Engineer"),
  ];
  const task = (id: string, name: string, to: string, priority: string, status: string, sessions: { start_time: string; end_time: string }[]): Task =>
    ({
      id, task_name: name, task_assigned_to: to, task_priority: priority, task_status: status,
      task_duration: "04:00", task_assigned_date: at(9), task_sessions: sessions,
    }) as Task;

  const tasks = [
    task("t1", "Rate-limit the public API", "QB0004", "P1", "done", [s(10, 12.5)]),
    task("t2", "Plan change proration", "QB0004", "P0", "in-progress", [s(13.5, 15), s(15.75, 17.5)]),
    task("t3", "New bottom navigation", "QB0009", "P1", "on-hold", [s(10.5, 12), s(14, 15.5)]),
    task("t4", "Dark mode color tokens", "QB0009", "P2", "done", [s(16, 18)]),
    task("t5", "Flaky checkout test", "QB0011", "P1", "done", [s(10, 11.5)]),
    task("t6", "Billing regression plan", "QB0011", "P2", "in-progress", [s(12.5, 14.5), s(15, 18.25)]),
  ];
  return {
    developers, tasks, config: { startHour: 10, endHour: 19 }, dayStart,
    dateKey: getLocalDateKey(new Date(dayStart.getTime() + 12 * 3600e3)),
  };
};
