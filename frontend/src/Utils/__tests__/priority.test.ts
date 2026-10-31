import { describe, it, expect } from "vitest";
import {
  PRIORITY_OPTIONS,
  PRIORITY_LABEL,
  getPriorityColor,
  getPriorityHex,
} from "Utils/priority";

describe("PRIORITY_OPTIONS", () => {
  it("lists P0 through P4 in descending-severity order", () => {
    expect(PRIORITY_OPTIONS).toEqual(["P0", "P1", "P2", "P3", "P4"]);
  });
});

describe("PRIORITY_LABEL", () => {
  it("has a human label for every priority option", () => {
    PRIORITY_OPTIONS.forEach((p) => {
      expect(PRIORITY_LABEL[p]).toBeTruthy();
    });
  });

  it("maps P0 to Critical and P4 to Lowest", () => {
    expect(PRIORITY_LABEL.P0).toBe("Critical");
    expect(PRIORITY_LABEL.P4).toBe("Lowest");
  });
});

describe("getPriorityColor", () => {
  it.each([
    ["P0", "red"],
    ["P1", "orange"],
    ["P2", "yellow"],
    ["P3", "blue"],
    ["P4", "gray"],
  ])("maps %s to %s", (priority, color) => {
    expect(getPriorityColor(priority)).toBe(color);
  });

  it("is case-insensitive", () => {
    expect(getPriorityColor("p0")).toBe("red");
  });

  it("falls back to gray for unknown/undefined priority", () => {
    expect(getPriorityColor("weird")).toBe("gray");
    expect(getPriorityColor(undefined)).toBe("gray");
    expect(getPriorityColor("")).toBe("gray");
  });
});

describe("getPriorityHex", () => {
  it.each([
    ["P0", "#dc2626"],
    ["P1", "#ea580c"],
    ["P2", "#ca8a04"],
    ["P3", "#2563eb"],
    ["P4", "#64748b"],
  ])("maps %s to %s", (priority, hex) => {
    expect(getPriorityHex(priority)).toBe(hex);
  });

  it("is case-insensitive and falls back to the P4 gray hex for unknowns", () => {
    expect(getPriorityHex("p1")).toBe("#ea580c");
    expect(getPriorityHex("nope")).toBe("#64748b");
    expect(getPriorityHex(undefined)).toBe("#64748b");
  });
});
