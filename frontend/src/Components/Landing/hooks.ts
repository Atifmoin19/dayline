import { RefObject, useEffect, useState } from "react";

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

/** True when the visitor asked the OS for less motion. */
export const usePrefersReducedMotion = (): boolean => {
  const [reduce, setReduce] = useState(
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCE_QUERY).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(REDUCE_QUERY);
    const onChange = () => setReduce(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduce;
};

/** True while `ref` is on screen (always true where IntersectionObserver is missing). */
export const useInView = (ref: RefObject<Element | null>, rootMargin = "0px"): boolean => {
  const [inView, setInView] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin]);
  return inView;
};

/**
 * A sample-day clock in hours (14.5 = 14:30) that advances `hoursPerTick` every `tickMs`
 * while `running`, and stops at `max`.
 */
export const useSampleClock = (start: number, opts: { running: boolean; tickMs: number; hoursPerTick: number; max: number }) => {
  const { running, tickMs, hoursPerTick, max } = opts;
  const [now, setNow] = useState(start);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow((n) => Math.min(max, n + hoursPerTick)), tickMs);
    return () => window.clearInterval(id);
  }, [running, tickMs, hoursPerTick, max]);
  return [now, setNow] as const;
};

/** Adds `is-in` to every `.dl-reveal` inside `root` as it scrolls into view, once. */
export const useScrollReveal = (root: RefObject<HTMLElement | null>) => {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>(".dl-reveal"));
    if (typeof IntersectionObserver === "undefined") {
      items.forEach((i) => i.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      }),
      { rootMargin: "0px 0px -8% 0px" },
    );
    items.forEach((i) => io.observe(i));
    return () => io.disconnect();
  }, [root]);
};
