import { Priority } from "types";

/** Single source for priority options + colors, reused everywhere (P0 highest → P4 lowest). */
export const PRIORITY_OPTIONS: Priority[] = ["P0", "P1", "P2", "P3", "P4"];

export const PRIORITY_LABEL: Record<string, string> = {
  P0: "Critical",
  P1: "High",
  P2: "Medium",
  P3: "Low",
  P4: "Lowest",
};

/** Chakra colorScheme for a priority — use on Badge/Button (semantic colors only). */
export const getPriorityColor = (p?: string): string => {
  switch ((p || "").toUpperCase()) {
    case "P0":
      return "red";
    case "P1":
      return "orange";
    case "P2":
      return "yellow";
    case "P3":
      return "blue";
    case "P4":
      return "gray";
    default:
      return "gray";
  }
};

/** Raw hex per priority — for the timeline blocks / non-Chakra fills. */
export const getPriorityHex = (p?: string): string => {
  switch ((p || "").toUpperCase()) {
    case "P0":
      return "#dc2626";
    case "P1":
      return "#ea580c";
    case "P2":
      return "#ca8a04";
    case "P3":
      return "#2563eb";
    case "P4":
      return "#64748b";
    default:
      return "#64748b";
  }
};
