import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDelayedFlag } from "hooks/useDelayedFlag";

afterEach(() => vi.useRealTimers());

describe("useDelayedFlag", () => {
  it("turns on only after the delay while active, and resets when inactive", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ active }) => useDelayedFlag(active, 2500), {
      initialProps: { active: true },
    });
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(2499));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
    rerender({ active: false });
    expect(result.current).toBe(false);
  });

  it("never fires if the work finishes first", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ active }) => useDelayedFlag(active, 2500), {
      initialProps: { active: true },
    });
    act(() => vi.advanceTimersByTime(1000));
    rerender({ active: false });
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current).toBe(false);
  });
});
