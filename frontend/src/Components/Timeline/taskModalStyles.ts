/**
 * Shared style tokens for the create-task and task-detail modals/pages — a single source so
 * the two surfaces (built from the same reference mockups) can't visually drift apart again.
 * Every fontSize below is one of the app's 4 sizes (Styles/index.ts) — never a one-off value.
 */

// Flat panel/soft-field background — same color for the free-text fields (title/description),
// the "Reference Materials" dropzone idle state, and the sidebar panel background.
export const PANEL_BG = "#f9fafb";
const PANEL_BORDER = "#f3f4f6";

export const LABEL_PROPS = {
  fontSize: "xs" as const,
  fontWeight: 700 as const,
  color: "neutral.500",
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
};

/** Free-text fields (title/description) — soft flat bg, focuses to a white+blue-glow state. */
export const softFieldProps = {
  bg: PANEL_BG,
  border: "1px solid",
  borderColor: "transparent",
  borderRadius: "0.75rem",
  fontSize: "sm" as const,
  px: 4,
  py: 3,
  h: "auto",
  _focus: {
    bg: "white",
    borderColor: "brand.600",
    boxShadow: "0 4px 12px rgba(37,99,235,0.08)",
  },
};

/** Structured fields (status/priority/due date/estimate) inside the sidebar panel. */
export const cardFieldProps = {
  bg: "white",
  border: "1px solid",
  borderColor: PANEL_BORDER,
  borderRadius: "0.75rem",
  boxShadow: "sm" as const,
  fontSize: "sm" as const,
};

export const sidebarPanelProps = {
  bg: PANEL_BG,
  border: "1px solid",
  borderColor: PANEL_BORDER,
  borderRadius: "1rem",
};
