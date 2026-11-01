import { KeyboardEvent, useRef, useState } from "react";

export interface Shot {
  id: string;
  tab: string;
  title: string;
  caption: string;
  src: string;
  alt: string;
}

/** Real screenshots from the demo workspace (1440x900 at 2x, saved at 2000x1250). */
const SHOTS: Shot[] = [
  {
    id: "my-work", tab: "My Work", title: "Your day at a glance",
    caption: "What is active, pending and overdue, the tasks at risk of slipping, and the team schedule underneath.",
    src: "/landing/my-work-manager.webp",
    alt: "My Work dashboard for the manager: counts of active, pending, overdue and completed tasks, an at-risk task flagged high risk, and the team schedule.",
  },
  {
    id: "timeline", tab: "Timeline", title: "One row per person, one bar per work session",
    caption: "Hover a bar to see its sessions and hold or finish the task right there. The red line is now.",
    src: "/landing/timeline.webp",
    alt: "Team timeline from 10 AM to 4 PM with colored session bars for each person and an open popover listing the work sessions of one task with Edit, Hold and Done buttons.",
  },
  {
    id: "week", tab: "Week", title: "The week, in logged hours",
    caption: "Hours and tasks per person per day, so a quiet Tuesday or a nine hour Thursday stands out.",
    src: "/landing/week.webp",
    alt: "Week view from Monday to Sunday with logged hours and task chips for each team member per day.",
  },
  {
    id: "calendar", tab: "Calendar", title: "Due dates on a month grid",
    caption: "Every task on the day it is due, colored by priority, with subtask progress on the chip.",
    src: "/landing/calendar.webp",
    alt: "Month calendar for November with task chips on their due dates.",
  },
  {
    id: "task", tab: "Task detail", title: "Everything about a task in one place",
    caption: "Subtasks with their own owners, Hold and Done, epic and sprint, due date, estimate, comments and attachments.",
    src: "/landing/task-detail.webp",
    alt: "Task detail for Plan change proration with two subtasks, a comment, and side panel fields for assignee, priority P0, status, epic, sprint, Hold and Done buttons.",
  },
  {
    id: "reports", tab: "Reports", title: "Load and throughput for your reporting line",
    caption: "Status mix, completions over the last seven days and active load per person, scoped to the people you manage.",
    src: "/landing/reports.webp",
    alt: "Reports page with total, in progress, completed and backlog counts, a status distribution chart, a seven day throughput chart and team load bars.",
  },
  {
    id: "org", tab: "Org chart", title: "The reporting tree decides who sees what",
    caption: "Expand any manager to see their team. Leads see their whole subtree, however deep.",
    src: "/landing/org-manager.webp",
    alt: "Organization tree with the VP of Engineering at the top and operations, product and engineering managers with their reports.",
  },
];

/** "Inside the app": a tablist of real screenshots. Only the active image is loaded. */
const AppShowcase = () => {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const shot = SHOTS[active];

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
    let next = active;
    if (e.key in keys) next = (active + keys[e.key] + SHOTS.length) % SHOTS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = SHOTS.length - 1;
    else return;
    e.preventDefault();
    setActive(next);
    tabs.current[next]?.focus();
  };

  return (
    <div className="dl-show">
      <div className="dl-show__tabs" role="tablist" aria-label="App screens" onKeyDown={onKey}>
        {SHOTS.map((s, i) => (
          <button
            key={s.id}
            ref={(el) => { tabs.current[i] = el; }}
            type="button"
            role="tab"
            id={`dl-tab-${s.id}`}
            aria-selected={i === active}
            aria-controls="dl-show-panel"
            tabIndex={i === active ? 0 : -1}
            className="dl-show__tab"
            onClick={() => setActive(i)}
          >
            {s.tab}
          </button>
        ))}
      </div>
      <div className="dl-show__panel" role="tabpanel" id="dl-show-panel" aria-labelledby={`dl-tab-${shot.id}`}>
        <div className="dl-show__copy">
          <h3>{shot.title}</h3>
          <p>{shot.caption}</p>
        </div>
        <figure className="dl-frame">
          <div className="dl-frame__bar" aria-hidden="true">
            <img src="/dayline.svg" alt="" width={14} height={14} />
            <span className="dl-frame__url">dayline / {shot.tab.toLowerCase()}</span>
          </div>
          <img key={shot.src} src={shot.src} alt={shot.alt} width={2000} height={1250} loading="lazy" decoding="async" />
        </figure>
      </div>
    </div>
  );
};

export default AppShowcase;
