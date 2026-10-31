export const APP_ENV = import.meta.env.VITE_APP_ENV ?? "";
export const BASE_URL = import.meta.env.VITE_APP_BASE_URL ?? "";
/** Signed-in home ("My Work"). "/" is the public landing page. */
export const APP_HOME = "/app";
/** Landing-page footer links. */
export const GITHUB_URL = import.meta.env.VITE_GITHUB_URL || "https://github.com/Atifmoin19/dayline";
export const PORTFOLIO_URL = "https://portfolio.fullstackcity.in";
/** Show "Try the demo" on the login page (the backend must also set DEMO_MODE_ENABLED=true). */
export const DEMO_ENABLED = import.meta.env.VITE_DEMO_ENABLED === "true";
/** Shared contact API that emails the owner about "Request a workspace" submissions. */
export const CONTACT_API_URL = (
  import.meta.env.VITE_CONTACT_API_URL || "https://api.fullstackcity.in/portfolio"
).replace(/\/+$/, "");

export const HEADER_HEIGHT = "3.6rem";

/** Width of the fixed desktop nav rail (`Components/Sidebar`) — lives here (not in Sidebar.tsx)
 * so that file only exports the component, per react-refresh's fast-refresh rule. */
export const SIDEBAR_WIDTH = "248px";

/**
 * Roles = job titles (designations), the single source of truth.
 * Rank drives ONLY: assignability (rank < 4 can receive tasks) and the admin gate (rank >= 4).
 * VISIBILITY is the org tree, not rank (see Utils/orgTree). Keys match the exact stored
 * `emp_designation` strings.
 */
export const ROLE_RANK: Record<string, number> = {
  // 5 — top executives
  "Chief Technology Officer": 5,
  "Chief Information Security Officer": 5,
  "Vice President, Engineering": 5,
  // 4 — senior management (not assignable, admin)
  "Director of Product": 4,
  "Engineering Manager": 4,
  // 3 — managers / leads
  "Senior Product Manager": 3,
  "Lead": 3,
  "Operations Lead": 3,
  "Tech Lead": 3,
  "Team Lead": 3,
  // 2 — senior individual contributors
  "Senior Software Engineer": 2,
  "Senior QA Engineer": 2,
  "Senior DevOps Engineer": 2,
  "Senior Operations Associate": 2,
  "UI/UX Designer": 2,
  // 1 — individual contributors / junior
  "Software Engineer": 1,
  "Associate Software Engineer": 1,
  "QA Engineer": 1,
  "Associate QA Engineer": 1,
  "Operations Associate": 1,
  "Machine Learning Intern": 1,
  "Software Engineering Intern": 1,
};

/** Selectable designations (create/edit user), most senior first. */
export const DESIGNATIONS = Object.keys(ROLE_RANK).sort(
  (a, b) => (ROLE_RANK[b] || 0) - (ROLE_RANK[a] || 0),
);

export const rankOf = (designation?: string): number => ROLE_RANK[designation || ""] || 0;

/**
 * SUPER_ADMIN = management tier (rank >= 4): may reach admin pages / user management.
 * ADMIN (management, non-super) = the lead/manager tier (rank 3): sees Reports + team views.
 * Derived from ROLE_RANK so a new title is classified automatically.
 */
export const SUPER_ADMIN_ROLES = Object.keys(ROLE_RANK).filter((k) => ROLE_RANK[k] >= 4);
export const ADMIN_ROLES = Object.keys(ROLE_RANK).filter((k) => ROLE_RANK[k] === 3);
