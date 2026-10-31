import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSavedViews } from "hooks/useSavedViews";

const FILTERS = { search: "foo", statusFilter: "todo", priorityFilter: "P1" };

beforeEach(() => {
  localStorage.clear();
});

describe("useSavedViews — localStorage-backed filter presets", () => {
  it("starts empty when nothing has been saved", () => {
    const { result } = renderHook(() => useSavedViews("emp1"));
    expect(result.current.views).toEqual([]);
  });

  it("saves a preset, lists it, and persists it to localStorage under a per-user key", () => {
    const { result } = renderHook(() => useSavedViews("emp1"));

    act(() => {
      result.current.saveView("My View", FILTERS);
    });

    expect(result.current.views).toHaveLength(1);
    expect(result.current.views[0]).toMatchObject({ name: "My View", ...FILTERS });
    expect(result.current.views[0].id).toBeTruthy();

    const persisted = JSON.parse(localStorage.getItem("taskboard.savedViews.emp1") as string);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ name: "My View", ...FILTERS });
  });

  it("re-applying a saved view means reading its persisted filters back out unchanged", () => {
    const { result } = renderHook(() => useSavedViews("emp1"));

    act(() => {
      result.current.saveView("My View", FILTERS);
    });

    const saved = result.current.views.find((v) => v.name === "My View");
    expect(saved).toBeDefined();
    // What the task list would do to "apply" it: read the three filter fields back out.
    expect(saved).toMatchObject(FILTERS);
  });

  it("deletes a saved view by id, updating state and persisted storage", () => {
    const { result } = renderHook(() => useSavedViews("emp1"));

    act(() => {
      result.current.saveView("My View", FILTERS);
    });
    const id = result.current.views[0].id;

    act(() => {
      result.current.deleteView(id);
    });

    expect(result.current.views).toEqual([]);
    const persisted = JSON.parse(localStorage.getItem("taskboard.savedViews.emp1") as string);
    expect(persisted).toEqual([]);
  });

  it("saving under an existing name (case-insensitive) replaces rather than duplicates", () => {
    const { result } = renderHook(() => useSavedViews("emp1"));

    act(() => {
      result.current.saveView("My View", FILTERS);
    });
    act(() => {
      result.current.saveView("my view", { search: "bar", statusFilter: "done", priorityFilter: "P0" });
    });

    expect(result.current.views).toHaveLength(1);
    expect(result.current.views[0]).toMatchObject({ search: "bar", statusFilter: "done", priorityFilter: "P0" });
  });

  it("ignores a blank/whitespace-only name (no-op, no crash)", () => {
    const { result } = renderHook(() => useSavedViews("emp1"));

    act(() => {
      result.current.saveView("   ", FILTERS);
    });

    expect(result.current.views).toEqual([]);
  });

  it("keeps different users' saved views isolated from one another", () => {
    const empA = renderHook(() => useSavedViews("empA"));
    const empB = renderHook(() => useSavedViews("empB"));

    act(() => {
      empA.result.current.saveView("A's View", FILTERS);
    });

    expect(empA.result.current.views).toHaveLength(1);
    expect(empB.result.current.views).toEqual([]);
    expect(localStorage.getItem("taskboard.savedViews.empB")).toBeNull();
  });

  it("recovers gracefully from corrupt JSON already in localStorage", () => {
    localStorage.setItem("taskboard.savedViews.emp1", "{not valid json");
    const { result } = renderHook(() => useSavedViews("emp1"));
    expect(result.current.views).toEqual([]);
  });
});
