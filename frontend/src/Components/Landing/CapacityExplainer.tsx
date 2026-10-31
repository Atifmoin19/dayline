import { capacityFor, BUSINESS_DAY_HOURS, CapacityBand } from "Utils/landingDemo";

const BAND_LABEL: Record<CapacityBand, string> = { available: "Available", at_capacity: "At capacity", over_capacitated: "Over capacity" };

/** Worked hours and never-started work per person; the percentages come from capacityFor. */
const PEOPLE = [
  { name: "Deniz", worked: 3, unstarted: 2 },
  { name: "Mira", worked: 5, unstarted: 3 },
  { name: "Tomas", worked: 4, unstarted: 16 },
];

/** Bars are drawn on a 0 to 150% scale so overload stays visible. */
const SCALE = 150;
const w = (pct: number) => `${(Math.min(pct, SCALE) / SCALE) * 100}%`;

export const CapacityChart = () => (
  <div className="dl-capchart" role="img" aria-label={PEOPLE.map((p) => {
    const c = capacityFor(p.worked, p.unstarted);
    return `${p.name}: ${p.worked} hours worked and ${p.unstarted} hours unstarted, today ${Math.round(c.days[0])}%, tomorrow ${Math.round(c.days[1])}%, ${BAND_LABEL[c.status]}`;
  }).join(". ")}>
    <div className="dl-capchart__axis" aria-hidden="true">
      <span style={{ left: w(70) }}>70%</span>
      <span style={{ left: w(100) }}>100%</span>
    </div>
    {PEOPLE.map((p) => {
      const c = capacityFor(p.worked, p.unstarted);
      const workedPct = (p.worked / BUSINESS_DAY_HOURS) * 100;
      return (
        <div className="dl-capchart__person" key={p.name} aria-hidden="true">
          <div className="dl-capchart__head">
            <strong>{p.name}</strong>
            <span>{p.worked}h worked, {p.unstarted}h not started</span>
            <span className={`dl-cap dl-cap--${c.status}`}>{BAND_LABEL[c.status]}</span>
          </div>
          {c.days.map((pct, i) => (
            <div className="dl-capchart__day" key={i}>
              <span className="dl-capchart__label">{i === 0 ? "Today" : "Tomorrow"}</span>
              <span className="dl-capchart__track">
                {i === 0 && <span className="dl-capchart__worked" style={{ width: w(workedPct) }} />}
                <span className="dl-capchart__queued" style={{ left: i === 0 ? w(workedPct) : 0, width: w(pct - (i === 0 ? workedPct : 0)) }} />
                <span className="dl-capchart__tick" style={{ left: w(70) }} />
                <span className="dl-capchart__tick is-full" style={{ left: w(100) }} />
              </span>
              <span className="dl-capchart__pct">{Math.round(pct)}%</span>
            </div>
          ))}
        </div>
      );
    })}
    <div className="dl-capchart__legend" aria-hidden="true">
      <span><i className="dl-capchart__worked" /> Worked today</span>
      <span><i className="dl-capchart__queued" /> Not started yet</span>
    </div>
  </div>
);

/** The two overdue rules, drawn on a mini lane each. */
export const OverdueLanes = () => (
  <div className="dl-lanes">
    <figure className="dl-lane">
      <div className="dl-lane__track" aria-hidden="true">
        <span className="dl-lane__eod"><em>19:00</em></span>
        <span className="dl-lane__bar" />
        <span className="dl-lane__ghost" />
      </div>
      <figcaption>
        <strong>Left running at 19:00</strong>
        Closed at 19:00 and put on hold. The same happens past midnight or after 12 hours open, so a forgotten task never logs a night shift.
      </figcaption>
    </figure>
    <figure className="dl-lane">
      <div className="dl-lane__track" aria-hidden="true">
        <span className="dl-lane__due"><em>due 15:30</em></span>
        <span className="dl-lane__chip">Billing settings page</span>
        <span className="dl-lane__arrow" />
        <span className="dl-lane__backlog">Backlog</span>
      </div>
      <figcaption>
        <strong>Not started, past due</strong>
        Moves to the backlog so the board shows what is really in play. Without a due date, the deadline is the last update plus the time left.
      </figcaption>
    </figure>
  </div>
);
