import { useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import DayTimeline from "Components/Landing/DayTimeline";
import { useInView, usePrefersReducedMotion, useSampleClock } from "Components/Landing/hooks";
import { PRIORITY_LABEL } from "Utils/priority";
import { durationLabel, statusText, hourToIso, hoursRemaining, hoursWorked } from "Utils/landingDemo";
import { buildSampleDay } from "Utils/landingSample";

/** One sample minute per real second: the now line creeps, the live bars grow. */
const TICK_MS = 1000;
const HOURS_PER_TICK = 1 / 60;

/** The hero's product visual: the app's timeline in an app-window frame, running live. */
const HeroTimeline = () => {
  const sample = useMemo(() => buildSampleDay(), []);
  const reduce = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const [paused, setPaused] = useState(false);
  const running = !paused && !reduce && inView;
  const [now] = useSampleClock(sample.startClock, { running, tickMs: TICK_MS, hoursPerTick: HOURS_PER_TICK, max: sample.config.endHour - 0.25 });
  const [selected, setSelected] = useState<string>("t03");

  const task = sample.tasks.find((t) => t.id === selected);
  const owner = sample.developers.find((d) => d.emp_id === task?.task_assigned_to);
  const nowIso = hourToIso(sample.dayStart, now);

  return (
    <div className="dl-window" ref={ref}>
      <div className="dl-window__bar">
        <img src="/dayline.svg" alt="" width={20} height={20} />
        <span className="dl-window__title">Team Schedule</span>
        <span className="dl-window__sub">Platform and QA, today</span>
        <span className="dl-live" aria-hidden="true">
          <span className="dl-live__dot" /> Live
        </span>
        <button
          type="button"
          className="dl-iconbtn"
          onClick={() => setPaused((p) => !p)}
          aria-label={paused ? "Play the sample clock" : "Pause the sample clock"}
          hidden={reduce}
        >
          {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
        </button>
      </div>
      <div className="dl-window__body">
        <DayTimeline
          sample={sample}
          tasks={sample.tasks}
          now={now}
          label="Sample day on the Dayline timeline"
          onSelect={setSelected}
          selectedId={selected}
        />
      </div>
      {task && (
        <div className="dl-window__foot">
          <span className="dl-chip">{task.task_priority}</span>
          <span className="dl-window__task">{task.task_name}</span>
          <span className="dl-window__meta">
            {owner?.emp_name.split(" ")[0]} · {statusText(task)} · {durationLabel(hoursWorked(task, nowIso))} logged
            {task.task_status === "in-progress" && ` · ${durationLabel(hoursRemaining(task, nowIso))} left`}
          </span>
          <span className="dl-sr">{PRIORITY_LABEL[task.task_priority || ""]} priority</span>
        </div>
      )}
    </div>
  );
};

export default HeroTimeline;
