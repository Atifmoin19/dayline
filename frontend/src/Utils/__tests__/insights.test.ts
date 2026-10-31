import { describe, it, expect } from "vitest";
import {
  RISK_LEVEL_COLOR,
  REBALANCE_IDLE_COLOR,
  REBALANCE_OVERLOADED_COLOR,
  findLocalTask,
  resolveEmpName,
  riskLevelColor,
  riskLevelLabel,
  sortAtRiskTasks,
} from "Utils/insights";
import { CAPACITY_STATUS_COLOR } from "Utils/capacity";
import { AtRiskTask, Employee, Task } from "types";

const atRisk = (risk_level: "medium" | "high", task_id = "t1"): AtRiskTask => ({
  task_id,
  task_name: `Task ${task_id}`,
  assignee_emp_id: "s001",
  risk_level,
  reason: "because",
});

describe("riskLevelColor / riskLevelLabel", () => {
  it("reuses the capacity view's over_capacitated color for high risk", () => {
    expect(riskLevelColor("high")).toBe(CAPACITY_STATUS_COLOR.over_capacitated);
  });

  it("reuses the capacity view's at_capacity color for medium risk", () => {
    expect(riskLevelColor("medium")).toBe(CAPACITY_STATUS_COLOR.at_capacity);
  });

  it("falls back gracefully for an unknown/missing level", () => {
    expect(riskLevelColor(undefined)).toBe("neutral.400");
    expect(riskLevelColor("low")).toBe("neutral.400");
  });

  it("labels each known level", () => {
    expect(riskLevelLabel("high")).toBe("High risk");
    expect(riskLevelLabel("medium")).toBe("Medium risk");
  });

  it("mirrors CAPACITY_STATUS_COLOR exactly rather than a parallel palette", () => {
    expect(RISK_LEVEL_COLOR.high).toBe(CAPACITY_STATUS_COLOR.over_capacitated);
    expect(RISK_LEVEL_COLOR.medium).toBe(CAPACITY_STATUS_COLOR.at_capacity);
    expect(REBALANCE_OVERLOADED_COLOR).toBe(CAPACITY_STATUS_COLOR.over_capacitated);
    expect(REBALANCE_IDLE_COLOR).toBe(CAPACITY_STATUS_COLOR.available);
  });
});

describe("sortAtRiskTasks", () => {
  it("puts high-risk tasks before medium-risk tasks", () => {
    const items = [atRisk("medium", "m1"), atRisk("high", "h1"), atRisk("medium", "m2"), atRisk("high", "h2")];
    const sorted = sortAtRiskTasks(items);
    expect(sorted.map((t) => t.task_id)).toEqual(["h1", "h2", "m1", "m2"]);
  });

  it("does not mutate the input array", () => {
    const items = [atRisk("medium", "m1"), atRisk("high", "h1")];
    const copy = [...items];
    sortAtRiskTasks(items);
    expect(items).toEqual(copy);
  });

  it("defaults to an empty array when given undefined", () => {
    expect(sortAtRiskTasks(undefined)).toEqual([]);
  });
});

describe("resolveEmpName", () => {
  const directory: Employee[] = [
    { emp_id: "s001", emp_name: "Alice", emp_email: "a@x.com", emp_designation: "Eng" },
  ];

  it("resolves a known emp_id to its display name", () => {
    expect(resolveEmpName("s001", directory)).toBe("Alice");
  });

  it("falls back to the raw emp_id when the directory hasn't loaded / doesn't have them", () => {
    expect(resolveEmpName("s999", directory)).toBe("s999");
    expect(resolveEmpName("s999", [])).toBe("s999");
    expect(resolveEmpName("s999", undefined)).toBe("s999");
  });
});

describe("findLocalTask", () => {
  const tasks: Task[] = [{ id: "42", task_name: "Do the thing" }];

  it("matches by string-coerced id", () => {
    expect(findLocalTask("42", tasks)?.task_name).toBe("Do the thing");
  });

  it("returns undefined when the task isn't in the locally-scoped list", () => {
    expect(findLocalTask("999", tasks)).toBeUndefined();
    expect(findLocalTask("42", undefined)).toBeUndefined();
  });
});
