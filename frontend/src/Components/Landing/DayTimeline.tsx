import { useMemo } from "react";
import { Check } from "lucide-react";
import { calculateSchedule } from "Utils/scheduler";
import { getPriorityHex, PRIORITY_LABEL } from "Utils/priority";
import { avatarColor, taskColor } from "Utils/avatar";
import { closeOpenForRender, clockLabel, statusText, hourToIso, hoursRemaining, nextAction, DemoAction } from "Utils/landingDemo";
import { SampleDay } from "Utils/landingSample";
import { Task, TaskBlock } from "types";

const ACTION_TEXT: Record<DemoAction, string> = { pick: "pick it up", hold: "put it on hold", resume: "resume it", done: "mark it done" };


/** Darken (f < 1) a hex color so white text on it clears WCAG AA at small sizes. */
const shade = (hex: string, f: number) =>
  `#${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * f).toString(16).padStart(2, "0")).join("")}`;
/** Mix a hex color with white (f = share of white), for finished work drawn with dark text. */
const tint = (hex: string, f: number) =>
  `#${[1, 3, 5].map((i) => { const c = parseInt(hex.slice(i, i + 2), 16); return Math.round(c + (255 - c) * f).toString(16).padStart(2, "0"); }).join("")}`;

const initials = (name: string) => name.split(" ").map((p) => p[0]).slice(0, 2).join("");

export interface DayTimelineProps {
  sample: Pick<SampleDay, "developers" | "dayStart" | "dateKey" | "config">;
  tasks: Task[];
  /** Sample-clock hour, e.g. 14.5. */
  now: number;
  label: string;
  /** Interactive mode: clicking a bar applies the task's next action. */
  onAct?: (taskId: string) => void;
  /** Hero mode: hovering or focusing a bar selects it. */
  onSelect?: (taskId: string) => void;
  selectedId?: string | null;
  /** Optional cell under each name, e.g. a capacity meter. */
  renderMeta?: (empId: string) => React.ReactNode;
}

/**
 * A compact copy of the app's day timeline. Bars are the output of the app's own
 * `calculateSchedule` (actual sessions only, exactly like TimelineView), drawn with the
 * same visual language: per-task fill, priority accent on the left, a live dot on the
 * running session and a red "now" line. Running work also gets its remaining estimate as a
 * dashed tail, like the app's "Show plan" overlay.
 */
const DayTimeline = ({ sample, tasks, now, label, onAct, onSelect, selectedId, renderMeta }: DayTimelineProps) => {
  const { startHour, endHour } = sample.config;
  const span = endHour - startHour;
  const pos = (h: number) => (Math.min(Math.max(h, startHour), endHour) - startHour) / span;
  const nowIso = hourToIso(sample.dayStart, now);

  const schedule = useMemo(
    () => calculateSchedule(closeOpenForRender(tasks, nowIso), sample.developers, sample.config, sample.dayStart, { actualOnly: true }),
    [tasks, nowIso, sample],
  );
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const hours = Array.from({ length: span + 1 }, (_, i) => startHour + i);

  return (
    <div className="dl-tl" role="group" aria-label={label} style={{ ["--now" as string]: pos(now) }}>
      <div className="dl-tl__scale" aria-hidden="true">
        <span />
        <div className="dl-tl__hours">
          {hours.map((h) => (
            <span key={h} className={h % 2 ? "is-odd" : undefined} style={{ left: `${pos(h) * 100}%` }}>
              {h}:00
            </span>
          ))}
        </div>
      </div>

      {sample.developers.map((dev) => {
        const blocks = (schedule[dev.emp_id] || []).filter((b: TaskBlock) => b.date === sample.dateKey);
        const live = tasks.filter((t) => t.task_assigned_to === dev.emp_id && t.task_sessions?.some((s) => !s.end_time));
        return (
          <div className="dl-tl__row" key={dev.emp_id}>
            <div className="dl-tl__who">
              <span className="dl-avatar" style={{ background: shade(avatarColor(dev.emp_name), 0.8) }} aria-hidden="true">
                {initials(dev.emp_name)}
              </span>
              <span className="dl-tl__name">
                <span className="dl-tl__first">{dev.emp_name.split(" ")[0]}</span>
                <span className="dl-tl__last"> {dev.emp_name.split(" ").slice(1).join(" ")}</span>
                {renderMeta?.(dev.emp_id)}
              </span>
            </div>
            <ul className="dl-tl__track" aria-label={`${dev.emp_name}'s sessions`}>
              {blocks.map((b: TaskBlock, i: number) => {
                const task = byId.get(b.taskId);
                if (!task) return null;
                const isLive = task.task_status === "in-progress" && Math.abs(b.endTime - now) < 0.02;
                const state = task.task_status === "done" ? "done" : task.task_status === "on-hold" ? "held" : task.task_status === "backlog" ? "backlog" : "active";
                const left = pos(b.startTime) * 100;
                const width = Math.max(0.6, (pos(b.endTime) - pos(b.startTime)) * 100);
                const action = nextAction(task);
                const name = `${task.task_name}, ${PRIORITY_LABEL[task.task_priority || ""] || task.task_priority} priority, ${statusText(task)}, ${clockLabel(b.startTime)} to ${isLive ? "now" : clockLabel(b.endTime)}`;
                const aria = onAct && action ? `${name}. Click to ${ACTION_TEXT[action]}.` : name;
                return (
                  <li
                    key={`${b.taskId}-${i}`}
                    title={aria}
                    // Pointer shortcut only: every action also has a full-size button in the task
                    // list, and hero details are in each item's text, so bars stay out of the tab order.
                    onClick={() => (onAct ? onAct(task.id) : onSelect?.(task.id))}
                    onMouseEnter={onSelect ? () => onSelect(task.id) : undefined}
                    className={`dl-bar dl-bar--${state}${isLive ? " is-live" : ""}${selectedId === task.id ? " is-selected" : ""}`}
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      ["--fill" as string]: state === "done" ? tint(taskColor(task.id), 0.72) : shade(taskColor(task.id), 0.8),
                      ["--accent" as string]: getPriorityHex(task.task_priority),
                    }}
                  >
                    <span className="dl-bar__fill" aria-hidden="true">
                      {state === "done" && <Check size={12} strokeWidth={3} />}
                      <span className="dl-bar__label">{task.task_name}</span>
                    </span>
                    <span className="dl-sr">{aria}</span>
                  </li>
                );
              })}
              {live.map((t) => {
                const rest = hoursRemaining(t, nowIso);
                if (rest <= 0 || now >= endHour) return null;
                const left = pos(now) * 100;
                const width = (pos(now + rest) - pos(now)) * 100;
                return (
                  <li
                    key={`${t.id}-plan`}
                    aria-hidden="true"
                    className="dl-bar dl-bar--plan"
                    style={{ left: `${left}%`, width: `${width}%`, ["--fill" as string]: shade(taskColor(t.id), 0.8) }}
                  />
                );
              })}
            </ul>
          </div>
        );
      })}

      <div className="dl-tl__now" aria-hidden="true">
        <span className="dl-tl__nowtag">{clockLabel(now)}</span>
      </div>
    </div>
  );
};

export default DayTimeline;
