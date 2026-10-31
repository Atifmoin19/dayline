import { useEffect, useState } from "react";

/**
 * Returns `value`, but only updates after it has stopped changing for `delayMs`. Used to
 * avoid firing a network request (e.g. assignee suggestions) on every keystroke while
 * someone is actively typing tags — the debounced value only "catches up" once typing pauses.
 *
 * Generic so it works for the tags string today and any other live-typed query input later.
 */
export const useDebouncedValue = <T>(value: T, delayMs: number): T => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
};
