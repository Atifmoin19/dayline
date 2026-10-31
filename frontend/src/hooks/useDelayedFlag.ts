import { useEffect, useState } from "react";

/** True once `active` has stayed true for `delayMs`; false again as soon as it turns off. */
export const useDelayedFlag = (active: boolean, delayMs: number): boolean => {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (!active) return undefined;
    const id = setTimeout(() => setElapsed(true), delayMs);
    return () => {
      clearTimeout(id);
      setElapsed(false);
    };
  }, [active, delayMs]);

  return active && elapsed;
};
