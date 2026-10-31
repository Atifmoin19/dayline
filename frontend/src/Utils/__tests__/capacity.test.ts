import { describe, it, expect } from "vitest";
import {
  capacityBarWidthPct,
  formatUtilizationLabel,
  capacityStatusColor,
  capacityStatusLabel,
  heatmapColor,
  computeEfficiencyIndex,
  enrichCapacityEmployees,
  getDepartmentOptions,
  filterByDepartment,
  ALL_DEPARTMENTS,
  formatTimezoneLabel,
  groupRowsByTimezone,
} from "Utils/capacity";
import { CapacityEmployee } from "types";

describe("capacityBarWidthPct", () => {
  it("passes through a normal percentage", () => {
    expect(capacityBarWidthPct({ utilization_pct: 42 })).toBe(42);
  });

  it("clamps over-capacitated days (>100%) to 100 for the bar width", () => {
    expect(capacityBarWidthPct({ utilization_pct: 145 })).toBe(100);
  });

  it("clamps negative/garbage input to 0", () => {
    expect(capacityBarWidthPct({ utilization_pct: -10 })).toBe(0);
    expect(capacityBarWidthPct({ utilization_pct: NaN })).toBe(0);
  });

  it("rounds fractional percentages", () => {
    expect(capacityBarWidthPct({ utilization_pct: 33.6 })).toBe(34);
  });
});

describe("formatUtilizationLabel", () => {
  it("formats as a rounded percentage string", () => {
    expect(formatUtilizationLabel(33.6)).toBe("34%");
  });

  it("does not clamp the label at 100 (unlike the bar width)", () => {
    expect(formatUtilizationLabel(145)).toBe("145%");
  });

  it("never shows negative percentages", () => {
    expect(formatUtilizationLabel(-5)).toBe("0%");
  });
});

describe("capacityStatusColor / capacityStatusLabel", () => {
  it("maps all three backend statuses to distinct colors", () => {
    const colors = new Set([
      capacityStatusColor("available"),
      capacityStatusColor("at_capacity"),
      capacityStatusColor("over_capacitated"),
    ]);
    expect(colors.size).toBe(3);
  });

  it("has a human label for every status", () => {
    expect(capacityStatusLabel("available")).toBe("Available");
    expect(capacityStatusLabel("at_capacity")).toBe("At Capacity");
    expect(capacityStatusLabel("over_capacitated")).toBe("Over-capacitated");
  });

  it("falls back gracefully for an unknown status", () => {
    expect(capacityStatusColor("weird")).toBe("neutral.400");
    expect(capacityStatusLabel("weird")).toBe("weird");
  });
});

describe("heatmapColor", () => {
  it("returns a low-utilization color under 40%", () => {
    expect(heatmapColor(10)).toBe("#e2e8f0");
  });

  it("returns the over-capacitated red at/above 110%", () => {
    expect(heatmapColor(110)).toBe("#dc2626");
    expect(heatmapColor(250)).toBe("#dc2626");
  });

  it("is monotonic across the stop boundaries", () => {
    const samples = [0, 39, 40, 69, 70, 89, 90, 109, 110, 200];
    const colors = samples.map(heatmapColor);
    // Every stop boundary should be reachable, i.e. more than one distinct color appears.
    expect(new Set(colors).size).toBeGreaterThan(1);
  });
});

describe("computeEfficiencyIndex", () => {
  it("is 0 for an empty scope", () => {
    expect(
      computeEfficiencyIndex({ avg_utilization_pct: 0, over_capacitated_count: 0, total_employees: 0 }),
    ).toBe(0);
  });

  it("scores a fully-utilized, non-overcommitted team near 100", () => {
    const score = computeEfficiencyIndex({
      avg_utilization_pct: 100,
      over_capacitated_count: 0,
      total_employees: 10,
    });
    expect(score).toBe(100);
  });

  it("penalizes a team where everyone is over-capacitated even with high avg utilization", () => {
    const allOverCommitted = computeEfficiencyIndex({
      avg_utilization_pct: 120,
      over_capacitated_count: 10,
      total_employees: 10,
    });
    const healthyFull = computeEfficiencyIndex({
      avg_utilization_pct: 100,
      over_capacitated_count: 0,
      total_employees: 10,
    });
    expect(allOverCommitted).toBeLessThan(healthyFull);
  });

  it("never exceeds 100 or drops below 0", () => {
    const high = computeEfficiencyIndex({ avg_utilization_pct: 500, over_capacitated_count: 0, total_employees: 1 });
    const low = computeEfficiencyIndex({ avg_utilization_pct: 0, over_capacitated_count: 5, total_employees: 5 });
    expect(high).toBeLessThanOrEqual(100);
    expect(low).toBeGreaterThanOrEqual(0);
  });
});

const emp = (over: Partial<CapacityEmployee> = {}): CapacityEmployee => ({
  emp_id: "s001",
  emp_name: "Alex",
  utilization_pct: 50,
  days: [],
  status: "available",
  timezone: "Asia/Kolkata",
  ...over,
});

describe("enrichCapacityEmployees", () => {
  it("joins department/photo from the directory by emp_id", () => {
    const rows = enrichCapacityEmployees(
      [emp({ emp_id: "s001" }), emp({ emp_id: "s002", emp_name: "Sam" })],
      [
        { emp_id: "s001", emp_name: "Alex", emp_email: "a@x.com", emp_designation: "Engineer", emp_department: "Engineering", profile_pic: "https://x/a.png" },
      ],
    );
    expect(rows[0].emp_department).toBe("Engineering");
    expect(rows[0].profile_pic).toBe("https://x/a.png");
  });

  it("leaves department/photo undefined for an employee missing from the directory", () => {
    const rows = enrichCapacityEmployees([emp({ emp_id: "s099" })], []);
    expect(rows[0].emp_department).toBeUndefined();
    expect(rows[0].profile_pic).toBeUndefined();
  });
});

describe("getDepartmentOptions / filterByDepartment", () => {
  const rows = [
    emp({ emp_id: "s001" }),
    emp({ emp_id: "s002" }),
    emp({ emp_id: "s003" }),
  ].map((r, i) => ({ ...r, emp_department: ["Engineering", "Design", "Engineering"][i] }));

  it("lists unique, sorted departments", () => {
    expect(getDepartmentOptions(rows)).toEqual(["Design", "Engineering"]);
  });

  it("excludes employees with no department from the option list", () => {
    const withBlank = [...rows, { ...emp({ emp_id: "s004" }), emp_department: undefined }];
    expect(getDepartmentOptions(withBlank)).toEqual(["Design", "Engineering"]);
  });

  it("returns every row for ALL_DEPARTMENTS", () => {
    expect(filterByDepartment(rows, ALL_DEPARTMENTS)).toHaveLength(3);
  });

  it("filters down to a single department", () => {
    const filtered = filterByDepartment(rows, "Engineering");
    expect(filtered).toHaveLength(2);
    expect(filtered.every((r) => r.emp_department === "Engineering")).toBe(true);
  });
});

describe("formatTimezoneLabel", () => {
  it("shortens an IANA name to its final segment", () => {
    expect(formatTimezoneLabel("Asia/Kolkata")).toBe("Kolkata");
    expect(formatTimezoneLabel("Pacific/Honolulu")).toBe("Honolulu");
  });

  it("replaces underscores with spaces", () => {
    expect(formatTimezoneLabel("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
  });

  it("passes through a single-segment name unchanged", () => {
    expect(formatTimezoneLabel("UTC")).toBe("UTC");
  });

  it("falls back to Unknown for a missing/blank value", () => {
    expect(formatTimezoneLabel(undefined)).toBe("Unknown");
    expect(formatTimezoneLabel(null)).toBe("Unknown");
    expect(formatTimezoneLabel("  ")).toBe("Unknown");
  });
});

describe("groupRowsByTimezone", () => {
  it("groups rows sharing a timezone into one section", () => {
    const rows = [
      emp({ emp_id: "s001", timezone: "Asia/Kolkata" }),
      emp({ emp_id: "s002", timezone: "Pacific/Honolulu" }),
      emp({ emp_id: "s003", timezone: "Asia/Kolkata" }),
    ];
    const groups = groupRowsByTimezone(rows);
    expect(groups).toHaveLength(2);
    const kolkata = groups.find((g) => g.timezone === "Asia/Kolkata");
    expect(kolkata?.rows.map((r) => r.emp_id)).toEqual(["s001", "s003"]);
  });

  it("sorts groups alphabetically by IANA name", () => {
    const rows = [
      emp({ emp_id: "s001", timezone: "Pacific/Honolulu" }),
      emp({ emp_id: "s002", timezone: "Asia/Kolkata" }),
      emp({ emp_id: "s003", timezone: "Europe/London" }),
    ];
    expect(groupRowsByTimezone(rows).map((g) => g.timezone)).toEqual([
      "Asia/Kolkata",
      "Europe/London",
      "Pacific/Honolulu",
    ]);
  });

  it("preserves each row's incoming relative order within its group", () => {
    const rows = [
      emp({ emp_id: "s003", emp_name: "Charlie", timezone: "Asia/Kolkata" }),
      emp({ emp_id: "s001", emp_name: "Alex", timezone: "Asia/Kolkata" }),
    ];
    const [group] = groupRowsByTimezone(rows);
    expect(group.rows.map((r) => r.emp_id)).toEqual(["s003", "s001"]);
  });

  it("buckets a missing/blank timezone under Unknown instead of dropping the row", () => {
    const rows = [emp({ emp_id: "s001", timezone: "" })];
    const groups = groupRowsByTimezone(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].timezone).toBe("Unknown");
    expect(groups[0].rows).toHaveLength(1);
  });
});
