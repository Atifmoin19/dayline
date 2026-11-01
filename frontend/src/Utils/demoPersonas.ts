import type { DemoPersona } from "types";

export interface DemoPersonaOption {
  persona: DemoPersona;
  /** Button label: "Manager", "Team lead", ... */
  label: string;
  /** The person you sign in as, from the Quillbrook Labs sample company. */
  who: string;
  /** One line on what this persona sees. */
  sees: string;
}

/** The four "Try the demo as" choices, shared by the login page and the landing page. */
export const DEMO_PERSONAS: DemoPersonaOption[] = [
  {
    persona: "manager",
    label: "Manager",
    who: "Odile, VP of Engineering",
    sees: "Every team: the team timeline, capacity, reports and insights for all 12 people.",
  },
  {
    persona: "team_lead",
    label: "Team lead",
    who: "Wren, tech lead",
    sees: "Her own work plus her two engineers' timelines, capacity and insights.",
  },
  {
    persona: "employee_1",
    label: "Employee 1",
    who: "Mira, backend engineer",
    sees: "Only her own tasks, with a timer running on today's work.",
  },
  {
    persona: "employee_2",
    label: "Employee 2",
    who: "Saoirse, designer on the Mobile team",
    sees: "Only her own tasks, on a different team from Mira.",
  },
];
