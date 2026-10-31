import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FastForward, Pause, Play, RotateCcw } from "lucide-react";
import DayTimeline from "Components/Landing/DayTimeline";
import { useInView, usePrefersReducedMotion, useSampleClock } from "Components/Landing/hooks";
import { getPriorityHex } from "Utils/priority";
import {
  applyAction, BUSINESS_END_HOUR, clockLabel, DemoAction, durationLabel, hourToIso, hoursWorked,
  nextAction, personCapacity, statusText, sweep,
} from "Utils/landingDemo";
import { buildSampleDay } from "Utils/landingSample";
import { Task } from "types";

/** Four sample minutes per real second: a full afternoon plays out in about a minute and a half. */
const TICK_MS = 250;
const HOURS_PER_TICK = 1 / 60;

const VERB: Record<DemoAction, string> = { pick: "picked", hold: "held", resume: "resumed", done: "finished" };
const BUTTON: Record<DemoAction, string> = { pick: "Pick", hold: "Hold", resume: "Resume", done: "Done" };
const BAND_LABEL = { available: "Available", at_capacity: "At capacity", over_capacitated: "Over capacity" };

interface LogLine { id: number; at: number; text: string; kind: "action" | "rule" }

/** "See your team's whole day": the sample team, live, with every task actionable. */
const TeamDayDemo = () => {
  const sample = useMemo(() => buildSampleDay(), []);
  const reduce = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, "-15% 0px");
  const [paused, setPaused] = useState(false);
  const [tasks, setTasks] = useState<Task[]>(sample.tasks);
  const [log, setLog] = useState<LogLine[]>([]);
  const end = BUSINESS_END_HOUR;
  const running = !paused && !reduce && inView;
  const [now, setNow] = useSampleClock(sample.startClock, { running, tickMs: TICK_MS, hoursPerTick: HOURS_PER_TICK, max: end });
  const nowIso = hourToIso(sample.dayStart, now);
  const nameOf = useCallback((id: string) => tasks.find((t) => t.id === id)?.task_name || id, [tasks]);
  const ownerOf = useCallback(
    (t?: Task) => sample.developers.find((d) => d.emp_id === t?.task_assigned_to)?.emp_name.split(" ")[0] || "",
    [sample],
  );

  const say = useCallback((text: string, kind: LogLine["kind"], at: number) => {
    setLog((l) => [{ id: Date.now() + Math.random(), at, text, kind }, ...l].slice(0, 4));
  }, []);

  // The backend's overdue sweep, run on every tick of the sample clock.
  useEffect(() => {
    const r = sweep(tasks, sample.dayStart, now);
    if (!r.autoHeld.length && !r.backlogged.length) return;
    setTasks(r.tasks);
    r.autoHeld.forEach((id) => say(`Business day over: "${nameOf(id)}" was still running, auto-held at ${clockLabel(end)}.`, "rule", now));
    r.backlogged.forEach((id) => say(`"${nameOf(id)}" passed its due time unstarted and moved to the backlog.`, "rule", now));
  }, [now, tasks, sample, end, nameOf, say]);

  const act = (id: string, action: DemoAction | null = null) => {
    const task = tasks.find((t) => t.id === id);
    const a = action ?? (task ? nextAction(task) : null);
    if (!task || !a || now >= end) return;
    const r = applyAction(tasks, id, a, nowIso);
    setTasks(r.tasks);
    const held = r.autoHeld.map((h) => `"${nameOf(h)}" auto-held`).join(", ");
    say(`${ownerOf(task)} ${VERB[a]} "${task.task_name}".${held ? ` ${held}: one running task per person.` : ""}`, "action", now);
  };

  const reset = () => {
    setTasks(sample.tasks);
    setLog([]);
    setNow(sample.startClock);
    setPaused(false);
  };

  const dayOver = now >= end;

  return (
    <div className="dl-demo" ref={ref}>
      <div className="dl-demo__controls">
        <span className="dl-demo__clock" aria-label={`Sample clock ${clockLabel(now)}`}>
          <span className="dl-live__dot" aria-hidden="true" /> {clockLabel(now)}
        </span>
        <button type="button" className="dl-btn dl-btn--quiet" onClick={() => setPaused((p) => !p)} disabled={dayOver || reduce}>
          {paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
          {paused ? "Play" : "Pause"}
        </button>
        <button type="button" className="dl-btn dl-btn--quiet" onClick={() => setNow((n) => Math.min(end, n + 0.5))} disabled={dayOver}>
          <FastForward size={15} aria-hidden="true" /> 30 min
        </button>
        <button type="button" className="dl-btn dl-btn--quiet" onClick={reset}>
          <RotateCcw size={15} aria-hidden="true" /> Reset
        </button>
      </div>

      <div className="dl-demo__board">
        <DayTimeline
          sample={sample}
          tasks={tasks}
          now={now}
          label="Interactive sample team timeline"
          onAct={(id) => act(id)}
          renderMeta={(emp) => {
            const c = personCapacity(tasks, emp, nowIso);
            return (
              <span className={`dl-cap dl-cap--${c.status}`} title={`Today ${Math.round(c.days[0])}%, tomorrow ${Math.round(c.days[1])}%`}>
                {BAND_LABEL[c.status]}
              </span>
            );
          }}
        />
        <ol className="dl-log" aria-live="polite" aria-label="What just happened">
          {log.length === 0 && <li className="dl-log__empty">Pick, hold, resume or finish a task below, or click a bar. Changes show up here.</li>}
          {log.map((l) => (
            <li key={l.id} className={`dl-log__${l.kind}`}>
              <time>{clockLabel(l.at)}</time> {l.text}
            </li>
          ))}
        </ol>
      </div>

      <div className="dl-people">
        {sample.developers.map((dev) => (
          <section key={dev.emp_id} aria-labelledby={`dl-people-${dev.emp_id}`}>
            <h3 id={`dl-people-${dev.emp_id}`}>{dev.emp_name}</h3>
            <ul className="dl-tasks">
              {tasks.filter((t) => t.task_assigned_to === dev.emp_id).map((t) => {
                const a = nextAction(t);
                return (
                  <li key={t.id} className={`dl-task dl-task--${t.task_status}`}>
                    <span className="dl-task__pri" style={{ ["--accent" as string]: getPriorityHex(t.task_priority) }}>{t.task_priority}</span>
                    <span className="dl-task__body">
                      <span className="dl-task__name">{t.task_name}</span>
                      <span className="dl-task__meta">
                        <span className="dl-task__status">{statusText(t)}</span>
                        {(t.task_sessions?.length || 0) > 0 && ` · ${durationLabel(hoursWorked(t, nowIso))} logged`}
                        {t.task_due_date && t.task_status === "todo" && ` · due ${clockLabel((new Date(t.task_due_date).getTime() - sample.dayStart.getTime()) / 3600e3)}`}
                      </span>
                    </span>
                    <span className="dl-task__actions">
                      {a && (
                        <button type="button" className="dl-btn dl-btn--sm" onClick={() => act(t.id, a)} disabled={dayOver} aria-label={`${BUTTON[a]} ${t.task_name}`}>
                          {BUTTON[a]}
                        </button>
                      )}
                      {(t.task_status === "in-progress" || t.task_status === "on-hold") && (
                        <button type="button" className="dl-btn dl-btn--sm dl-btn--ghost" onClick={() => act(t.id, "done")} disabled={dayOver} aria-label={`Mark ${t.task_name} done`}>
                          Done
                        </button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      {dayOver && (
        <p className="dl-demo__over" role="status">
          19:00, the business day is over. Open sessions were closed at 19:00 and put on hold.{" "}
          <button type="button" className="dl-linkbtn" onClick={reset}>Replay the afternoon</button>
        </p>
      )}
    </div>
  );
};

export default TeamDayDemo;
