import { useRef } from "react";
import { Link as RouterLink } from "react-router-dom";
import { ArrowRight, Check } from "lucide-react";
import { FaGithub } from "react-icons/fa";
import { useAppSelector } from "app/hooks";
import DemoLauncher from "Components/Demo/DemoLauncher";
import AppShowcase from "Components/Landing/AppShowcase";
import { CapacityChart, OverdueLanes } from "Components/Landing/CapacityExplainer";
import HeroTimeline from "Components/Landing/HeroTimeline";
import TeamDayDemo from "Components/Landing/TeamDayDemo";
import { useScrollReveal } from "Components/Landing/hooks";
import { useDemoLaunch } from "hooks/useDemoLaunch";
import { APP_HOME, DEMO_ENABLED, GITHUB_URL, PORTFOLIO_URL } from "Utils/constants";
import { DemoPersona } from "types";
import { DEMO_PERSONAS } from "Utils/demoPersonas";
import "./landing.css";

const Logo = () => (
  <span className="dl-logo">
    <img src="/dayline.svg" alt="" width={28} height={28} />
    <span>Dayline</span>
  </span>
);

const ROLES: { persona: DemoPersona; who: string; title: string; shot: string; alt: string; sees: string[]; does: string[] }[] = [
  {
    persona: "manager",
    who: "Odile Marchetti",
    title: "Vice President, Engineering",
    shot: "/landing/my-work-manager.webp",
    alt: "The manager's My Work: 10 active tasks, 8 pending, 1 overdue and 12 team members, with an at-risk task flagged.",
    sees: [
      "Every task of the 11 people in her reporting line",
      "The team timeline, week and calendar for anyone below her",
      "At-risk tasks, capacity, reports and the resource heatmap",
    ],
    does: ["Assigns and reprioritises work", "Runs epics, the roadmap and sprints", "Manages people and roles, with an audit log (admin only, off in the demo)"],
  },
  {
    persona: "employee_1",
    who: "Mira Okafor",
    title: "Senior Software Engineer",
    shot: "/landing/my-work-developer.webp",
    alt: "An engineer's My Work: her own in-progress, pending and completed counts, time logged, and her own schedule.",
    sees: [
      "Her own tasks, timeline, week and calendar",
      "The org chart with her line: Wren, then Kasimir, then Odile",
      "Company-wide epics, roadmap and sprints",
    ],
    does: ["Picks, holds, resumes and finishes work; the hours log themselves", "Comments, attaches images, links tasks and splits them into subtasks", "Gets a nudge when assigned work sits unpicked"],
  },
];

const ENGINEERING = [
  { k: "Live", t: "WebSocket updates", d: "A pick, hold or edit on one screen shows up on every other open screen." },
  { k: "Jobs", t: "In-process scheduler", d: "The overdue sweep every 60 seconds and the hourly demo purge, guarded by Postgres advisory locks so only one instance runs each job." },
  { k: "Demo", t: "Isolated workspaces", d: "Every visitor gets their own copy of the sample company, scoped by workspace and purged when it expires." },
  { k: "Tests", t: "260 backend + 190 frontend", d: "pytest against Postgres for the API and rules, Vitest and Testing Library for the UI." },
  { k: "Host", t: "One free process", d: "FastAPI and Postgres. No Redis, no worker: sessions and fan-out fall back to the database and the process." },
];

/** Persona button for the demo section. */
const PersonaButton = ({ persona, label }: { persona: DemoPersona; label: string }) => {
  const { launch, isLoading, waking } = useDemoLaunch();
  return (
    <span className="dl-persona__cta">
      <button type="button" className="dl-btn dl-btn--primary" onClick={() => launch(persona)} disabled={isLoading} aria-busy={isLoading}>
        {isLoading ? (waking ? "Waking the server…" : "Setting up your demo…") : label}
        {!isLoading && <ArrowRight size={16} aria-hidden="true" />}
      </button>
      {waking && <span className="dl-persona__wait" role="status">The first request after a quiet spell can take up to a minute.</span>}
    </span>
  );
};

/** Public landing page at "/". Signed-in visitors get "Open app" instead of the sign-in buttons. */
const Landing = () => {
  const signedIn = useAppSelector((state) => Boolean(state.scheduler.currentUser));
  const root = useRef<HTMLDivElement>(null);
  useScrollReveal(root);

  const ctas = (where: "hero" | "band") =>
    signedIn ? (
      <div className="dl-ctas">
        <RouterLink to={APP_HOME} className="dl-btn dl-btn--primary dl-btn--lg">
          Open app <ArrowRight size={18} aria-hidden="true" />
        </RouterLink>
      </div>
    ) : (
      <div className="dl-ctas">
        {DEMO_ENABLED && (
          <div className={`dl-ctas__demo dl-ctas__demo--${where}`}>
            <DemoLauncher tone="solid" />
          </div>
        )}
        <RouterLink to="/request-workspace" className={`dl-btn dl-btn--lg ${DEMO_ENABLED ? "dl-btn--outline" : "dl-btn--primary"}`}>
          Request a workspace
        </RouterLink>
      </div>
    );

  return (
    <div className="dl" ref={root}>
      <a href="#main" className="dl-skip">Skip to content</a>
      <header className="dl-header">
        <div className="dl-wrap dl-header__in">
          <RouterLink to="/" className="dl-header__brand" aria-label="Dayline home"><Logo /></RouterLink>
          <nav className="dl-header__nav" aria-label="Sections">
            <a href="#team-day">How it works</a>
            <a href="#inside">Inside the app</a>
            <a href="#roles">Roles</a>
            {DEMO_ENABLED && <a href="#demo">Demo</a>}
          </nav>
          {signedIn ? (
            <RouterLink to={APP_HOME} className="dl-btn dl-btn--sm dl-btn--primary">Open app</RouterLink>
          ) : (
            <RouterLink to="/login" className="dl-btn dl-btn--sm dl-btn--outline">Sign in</RouterLink>
          )}
        </div>
      </header>

      <main id="main">
        <section className="dl-hero" aria-labelledby="hero-title">
          <div className="dl-wrap dl-hero__grid">
            <div className="dl-hero__copy">
              <p className="dl-eyebrow">Task scheduling and time tracking for teams</p>
              <h1 id="hero-title" className="dl-display">
                Your team&apos;s day, <span className="dl-mark">live</span> on one timeline.
              </h1>
              <p className="dl-lede">
                Dayline puts every task on a shared day timeline. People pick, hold and finish work, the hours log
                themselves, and you see overload and overdue work before it slips.
              </p>
              {ctas("hero")}
              {DEMO_ENABLED && !signedIn && (
                <ul className="dl-ticks" aria-label="About the demo">
                  <li><Check size={14} aria-hidden="true" /> No sign-up</li>
                  <li><Check size={14} aria-hidden="true" /> Your own sample company</li>
                  <li><Check size={14} aria-hidden="true" /> Resets in 24 hours</li>
                </ul>
              )}
            </div>
            <div className="dl-hero__visual">
              <HeroTimeline />
              <p className="dl-hero__note">Running on Dayline&apos;s own scheduling code. Hover a bar.</p>
            </div>
          </div>
        </section>

        <section id="team-day" className="dl-section" aria-labelledby="team-day-title">
          <div className="dl-wrap">
            <div className="dl-head dl-reveal">
              <p className="dl-eyebrow">See your team&apos;s whole day</p>
              <h2 id="team-day-title" className="dl-h2">Click a task. Watch the day recompute.</h2>
              <p className="dl-sub">
                Four people from the sample company, mid-afternoon. Pick, hold, resume or finish anything: the bars come from
                the same scheduler the app runs, and the backend&apos;s rules apply as the clock moves.
              </p>
            </div>
            <div className="dl-reveal">
              <TeamDayDemo />
            </div>
            <ul className="dl-rules dl-reveal">
              <li><strong>One running task per person.</strong> Picking something new holds what you had open, time kept.</li>
              <li><strong>Time is sessions, not guesses.</strong> Logged hours are the sum of real pick-to-hold stretches.</li>
              <li><strong>Watch 15:30 and 19:00.</strong> An unstarted task passes its due time; the day ends with work still open.</li>
            </ul>
          </div>
        </section>

        <section id="inside" className="dl-section dl-section--tint" aria-labelledby="inside-title">
          <div className="dl-wrap">
            <div className="dl-head dl-reveal">
              <p className="dl-eyebrow">Inside the app</p>
              <h2 id="inside-title" className="dl-h2">What you get after you sign in.</h2>
              <p className="dl-sub">Screens from the demo workspace, as a manager and as an engineer.</p>
            </div>
            <div className="dl-reveal">
              <AppShowcase />
            </div>
          </div>
        </section>

        <section id="capacity" className="dl-section" aria-labelledby="capacity-title">
          <div className="dl-wrap">
            <div className="dl-head dl-reveal">
              <p className="dl-eyebrow">Capacity and overdue</p>
              <h2 id="capacity-title" className="dl-h2">Know who is overloaded before the deadline does.</h2>
            </div>
            <div className="dl-split">
              <div className="dl-reveal">
                <h3 className="dl-h3">How capacity is counted</h3>
                <p className="dl-formula">
                  (<span>worked today</span> + <span>not started yet</span>) ÷ <span>9 h day, 10:00 to 19:00</span>
                </p>
                <p className="dl-body">
                  Unstarted work fills today&apos;s headroom first and spills into tomorrow. A person is{" "}
                  <span className="dl-cap dl-cap--available">Available</span> under 70%,{" "}
                  <span className="dl-cap dl-cap--at_capacity">At capacity</span> up to 100% and{" "}
                  <span className="dl-cap dl-cap--over_capacitated">Over capacity</span> beyond it, judged on their worst day.
                </p>
                <CapacityChart />
              </div>
              <div className="dl-reveal">
                <h3 className="dl-h3">When work slips</h3>
                <p className="dl-body">A sweep runs every 60 seconds, and once at startup, and keeps the board honest on its own.</p>
                <OverdueLanes />
                <p className="dl-body dl-body--small">
                  At-risk tasks are ranked by how close they are and how much is left, and the insight panel suggests moving
                  work from someone over capacity to someone with room, preferring shared skills.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="roles" className="dl-section dl-section--tint" aria-labelledby="roles-title">
          <div className="dl-wrap">
            <div className="dl-head dl-reveal">
              <p className="dl-eyebrow">Roles and visibility</p>
              <h2 id="roles-title" className="dl-h2">Same app. Each person sees their part of the org.</h2>
              <p className="dl-sub">
                Visibility follows the reporting tree, not job titles: a lead sees their whole subtree, however deep.
                Department admins and read-only auditors get scoped grants instead of full admin.
              </p>
            </div>
            <div className="dl-roles">
              {ROLES.map((r) => (
                <article key={r.persona} className="dl-role dl-reveal" aria-labelledby={`role-${r.persona}`}>
                  <header className="dl-role__head">
                    <span className="dl-role__tag">{r.persona === "manager" ? "Manager" : "Employee"}</span>
                    <h3 id={`role-${r.persona}`} className="dl-h3">{r.who}</h3>
                    <p>{r.title}</p>
                  </header>
                  <img className="dl-role__shot" src={r.shot} alt={r.alt} width={2000} height={1250} loading="lazy" decoding="async" />
                  <div className="dl-role__lists">
                    <div>
                      <h4>Sees</h4>
                      <ul>{r.sees.map((s) => <li key={s}>{s}</li>)}</ul>
                    </div>
                    <div>
                      <h4>Does</h4>
                      <ul>{r.does.map((s) => <li key={s}>{s}</li>)}</ul>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {DEMO_ENABLED && (
          <section id="demo" className="dl-section dl-section--ink" aria-labelledby="demo-title">
            <div className="dl-wrap dl-demo-sec">
              <div className="dl-reveal">
                <p className="dl-eyebrow">Built to be tried</p>
                <h2 id="demo-title" className="dl-h2">A whole company to click around in, just for you.</h2>
                <dl className="dl-facts">
                  <div><dt>12</dt><dd>people across Platform, Mobile and Quality &amp; Ops</dd></div>
                  <div><dt>27</dt><dd>tasks with live timers, epics, a sprint and subtasks</dd></div>
                  <div><dt>24 h</dt><dd>then your private copy is deleted</dd></div>
                  <div><dt>Off</dt><dd>emails and notifications, so nobody gets pinged</dd></div>
                </dl>
                {signedIn ? (
                  <RouterLink to={APP_HOME} className="dl-btn dl-btn--primary dl-btn--lg">Open app <ArrowRight size={18} aria-hidden="true" /></RouterLink>
                ) : (
                  <>
                    <div className="dl-personas">
                      {DEMO_PERSONAS.map((p) => (
                        <div key={p.persona} className="dl-persona">
                          <p><strong>{p.label}: {p.who}.</strong> {p.sees}</p>
                          <PersonaButton persona={p.persona} label={`Explore as ${p.label}`} />
                        </div>
                      ))}
                    </div>
                    <p className="dl-demo-sec__more">
                      Want it for your own team?{" "}
                      <RouterLink to="/request-workspace">Request a workspace</RouterLink>
                    </p>
                  </>
                )}
              </div>
              <div className="dl-phones dl-reveal" aria-hidden="true">
                <img src="/landing/mobile-my-work.webp" alt="" width={780} height={1688} loading="lazy" decoding="async" />
                <img src="/landing/mobile-pending.webp" alt="" width={780} height={1688} loading="lazy" decoding="async" />
              </div>
            </div>
          </section>
        )}

        <section id="engineering" className="dl-section" aria-labelledby="eng-title">
          <div className="dl-wrap">
            <div className="dl-head dl-reveal">
              <p className="dl-eyebrow">Under the hood</p>
              <h2 id="eng-title" className="dl-h2">Small stack, real constraints.</h2>
              <p className="dl-sub">
                React 19, TypeScript, Vite, Chakra UI and RTK Query in front. FastAPI, SQLAlchemy and Postgres behind.
              </p>
            </div>
            <dl className="dl-eng dl-reveal">
              {ENGINEERING.map((e) => (
                <div key={e.k} className="dl-eng__item">
                  <dt><span className="dl-eng__k">{e.k}</span>{e.t}</dt>
                  <dd>{e.d}</dd>
                </div>
              ))}
            </dl>
            <a className="dl-textlink dl-reveal" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              <FaGithub size={18} aria-hidden="true" /> Read the source on GitHub <ArrowRight size={16} aria-hidden="true" />
            </a>
          </div>
        </section>

        <section className="dl-band" aria-labelledby="band-title">
          <div className="dl-wrap dl-band__in">
            <h2 id="band-title" className="dl-h2">See a real day in Dayline.</h2>
            <p className="dl-sub">
              {DEMO_ENABLED && !signedIn
                ? "Open the demo and pick up a task. It takes a few seconds."
                : "Request a workspace for your team, or sign in if you've been invited."}
            </p>
            {ctas("band")}
          </div>
        </section>
      </main>

      <footer className="dl-footer">
        <div className="dl-wrap dl-footer__in">
          <Logo />
          <p>
            Built by{" "}
            <a href={PORTFOLIO_URL} target="_blank" rel="noopener noreferrer">Atif Moin</a>
          </p>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">Source on GitHub</a>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
