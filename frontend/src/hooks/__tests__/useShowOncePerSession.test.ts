import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useShowOncePerSession } from "hooks/useShowOncePerSession";

describe("useShowOncePerSession", () => {
  beforeEach(() => sessionStorage.clear());

  it("opens as soon as there is something to show, even if data arrives after first paint", () => {
    const { result, rerender } = renderHook(({ ready }) => useShowOncePerSession("k:u1", ready), {
      initialProps: { ready: false },
    });
    expect(result.current.isOpen).toBe(false);
    rerender({ ready: true });
    expect(result.current.isOpen).toBe(true);
  });

  it("re-opens after a remount if the user never dismissed it (old bug: flag set on open)", () => {
    const first = renderHook(() => useShowOncePerSession("k:u1", true));
    expect(first.result.current.isOpen).toBe(true);
    first.unmount(); // e.g. the header remounts on navigation before the modal was seen
    const second = renderHook(() => useShowOncePerSession("k:u1", true));
    expect(second.result.current.isOpen).toBe(true);
  });

  it("stays closed for the rest of the session once dismissed", () => {
    const first = renderHook(() => useShowOncePerSession("k:u1", true));
    act(() => first.result.current.close());
    expect(first.result.current.isOpen).toBe(false);
    first.unmount();
    const second = renderHook(() => useShowOncePerSession("k:u1", true));
    expect(second.result.current.isOpen).toBe(false);
  });

  it("tracks each key (user) separately", () => {
    const a = renderHook(() => useShowOncePerSession("k:u1", true));
    act(() => a.result.current.close());
    const b = renderHook(() => useShowOncePerSession("k:u2", true));
    expect(b.result.current.isOpen).toBe(true);
  });

  it("can still be opened manually after dismissal", () => {
    const { result } = renderHook(() => useShowOncePerSession("k:u1", true));
    act(() => result.current.close());
    act(() => result.current.open());
    expect(result.current.isOpen).toBe(true);
  });
});
