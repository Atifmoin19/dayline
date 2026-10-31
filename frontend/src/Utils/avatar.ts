// Distinct, professional avatar backgrounds — deep saturated hues (Tailwind ~600–800).
// Clearly differentiated from each other, but not the neon/pastel Chakra defaults.
// Red is intentionally omitted (reserved for priority/status). White text sits on all.
const PALETTE = [
  "#4f46e5", // indigo
  "#0d9488", // teal
  "#0369a1", // sky
  "#6d28d9", // violet
  "#047857", // emerald
  "#b45309", // amber / bronze
  "#9f1239", // rose
  "#0e7490", // cyan
  "#86198f", // fuchsia
  "#475569", // slate
];

export const avatarColor = (name?: string): string => {
  const s = name || "?";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
};

// Vivid, saturated fills for timeline task segments — brighter than the avatar palette
// (no dull slate/gray) so bars pop. White text is readable on every entry. Priority stays
// the left-border accent, not the fill.
const TASK_PALETTE = [
  "#4f46e5", // indigo
  "#2563eb", // blue
  "#0284c7", // sky
  "#0891b2", // cyan
  "#0d9488", // teal
  "#059669", // emerald
  "#7c3aed", // violet
  "#9333ea", // purple
  "#c026d3", // fuchsia
  "#db2777", // pink
  "#e11d48", // rose
  "#d97706", // amber
];

// Deterministic solid fill per task id — so two adjacent same-priority tasks on one
// timeline ribbon never collapse to the same color.
export const taskColor = (taskId?: string): string => {
  const s = taskId || "?";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  return TASK_PALETTE[h % TASK_PALETTE.length];
};
