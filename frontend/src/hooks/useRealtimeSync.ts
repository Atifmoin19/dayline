import { useEffect, useRef } from "react";
import { useAppDispatch, useAppSelector } from "app/hooks";
import { userApi } from "Services/user.api";
import { BASE_URL } from "Utils/constants";

/**
 * Opens a WebSocket to the backend `/ws` and, on a `tasks_changed` ping, invalidates the RTK
 * `Task` cache so all views refetch immediately — replacing reliance on the 60 s poll (which
 * stays as a safety net). Auto-reconnects with capped exponential backoff.
 */
export const useRealtimeSync = () => {
  const dispatch = useAppDispatch();
  const currentUser = useAppSelector((s) => s.scheduler?.currentUser);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);

  useEffect(() => {
    if (!currentUser) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const buildUrl = () => {
      let base = BASE_URL;
      if (!base || base.startsWith("/")) {
        base = window.location.origin + (base || "");
      }
      return base.replace(/^http/, "ws").replace(/\/$/, "") + "/ws";
    };

    const connect = () => {
      if (stopped) return;
      try {
        const ws = new WebSocket(buildUrl());
        wsRef.current = ws;
        ws.onopen = () => {
          retryRef.current = 0;
        };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg?.type === "tasks_changed") {
              dispatch(userApi.util.invalidateTags(["Task"]));
            }
          } catch {
            /* ignore malformed frames */
          }
        };
        ws.onclose = () => {
          if (stopped) return;
          const delay = Math.min(30000, 1000 * 2 ** retryRef.current);
          retryRef.current += 1;
          timer = setTimeout(connect, delay);
        };
        ws.onerror = () => {
          try {
            ws.close();
          } catch {
            /* noop */
          }
        };
      } catch {
        timer = setTimeout(connect, 5000);
      }
    };
    connect();

    return () => {
      stopped = true;
      clearTimeout(timer);
      try {
        wsRef.current?.close();
      } catch {
        /* noop */
      }
    };
  }, [currentUser, dispatch]);
};
