import { useMemo } from "react";
import { useAppSelector } from "app/hooks";
import { Task } from "types";

/**
 * The current user's actionable "task reminders": their backlog / todo / on-hold tasks that are
 * due today (or overdue on-hold), within business hours. Shared by the header notification
 * center and the pending-tasks modal so both agree on the count and list.
 */
export const usePendingTasks = (): Task[] => {
  const { tasks, currentUser, config } = useAppSelector((state) => state.scheduler);

  return useMemo(() => {
    if (!currentUser) return [];

    const now = new Date();
    const currentHour = now.getHours() + now.getMinutes() / 60;
    // Outside business hours → reminders defer to the next working day.
    if (currentHour >= config.endHour) return [];

    const userTasks = tasks.filter((t) => {
      if (t.task_assigned_to !== currentUser.emp_id) return false;
      const s = (t.task_status || "").toLowerCase();
      // Explicit exclude (not just relying on the allowlist below) so a done/completed task
      // never lingers here regardless of status casing.
      if (s === "done" || s === "completed") return false;
      return s === "backlog" || s === "todo" || s === "on-hold";
    });

    const getEffectiveStartDate = (t: Task) => {
      if (t.task_assigned_date) return new Date(t.task_assigned_date);
      const created = t.task_created_at ? new Date(t.task_created_at) : new Date();
      const END_HOUR = config.endHour;
      const START_HOUR = config.startHour;
      const h = created.getHours() + created.getMinutes() / 60;
      if (h >= END_HOUR) {
        const nextDay = new Date(created);
        nextDay.setDate(nextDay.getDate() + 1);
        nextDay.setHours(START_HOUR, 0, 0, 0);
        return nextDay;
      }
      return created;
    };

    return userTasks
      .filter((t) => {
        const effectiveStart = getEffectiveStartDate(t);
        const todayMidnight = new Date();
        todayMidnight.setHours(0, 0, 0, 0);
        const tomorrowMidnight = new Date(todayMidnight);
        tomorrowMidnight.setDate(tomorrowMidnight.getDate() + 1);
        if (effectiveStart >= tomorrowMidnight) return false;
        if (t.task_status !== "on-hold" && effectiveStart < todayMidnight) return false;
        return true;
      })
      .sort((a, b) => {
        const order: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
        const pA = order[a.task_priority as string] ?? 2;
        const pB = order[b.task_priority as string] ?? 2;
        if (pA !== pB) return pA - pB;
        return getEffectiveStartDate(a).getTime() - getEffectiveStartDate(b).getTime();
      });
  }, [tasks, currentUser, config]);
};
