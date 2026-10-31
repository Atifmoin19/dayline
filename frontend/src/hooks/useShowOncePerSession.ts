import { useCallback, useEffect, useState } from "react";

const read = (key: string) => {
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};
const write = (key: string) => {
  try {
    sessionStorage.setItem(key, "1");
  } catch {
    /* storage unavailable: worst case the dialog shows again */
  }
};

/**
 * Auto-open something (e.g. the pending-tasks modal) once per browser session per `key`.
 * It is marked as seen only when the user dismisses it, not when it opens, so a remount
 * between opening and seeing it (route change, late data, StrictMode) can't swallow it.
 */
export const useShowOncePerSession = (key: string, shouldShow: boolean) => {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (shouldShow && !read(key)) setIsOpen(true);
  }, [key, shouldShow]);

  const close = useCallback(() => {
    write(key);
    setIsOpen(false);
  }, [key]);
  const open = useCallback(() => setIsOpen(true), []);

  return { isOpen, open, close };
};
