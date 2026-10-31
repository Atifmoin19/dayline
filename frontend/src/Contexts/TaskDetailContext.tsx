import React, { Suspense, lazy, useCallback, useMemo, useState } from "react";
import { Task } from "types";
// Lazy: the task detail modal (and its comments/attachments/links editors) is app-only, so
// keeping it out of the entry chunk keeps the landing page's first load small.
const TaskDetailModal = lazy(() => import("Components/Timeline/TaskDetailModal"));
import { TaskDetailContext } from "Contexts/useTaskDetail";

/**
 * Single global owner of the "task detail" (Jira-style) modal — mounted once in
 * `SimpleLayout` so any component (timeline, task list, pending-tasks modal, week/calendar
 * views) can open the same canonical view/edit surface via `useTaskDetail()` (Contexts/useTaskDetail),
 * instead of each page owning its own duplicate edit-modal state.
 */
export const TaskDetailProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [task, setTask] = useState<Task | null>(null);

  const openTaskDetail = useCallback((t: Task) => setTask(t), []);
  const closeTaskDetail = useCallback(() => setTask(null), []);

  const value = useMemo(() => ({ openTaskDetail, closeTaskDetail }), [openTaskDetail, closeTaskDetail]);

  return (
    <TaskDetailContext.Provider value={value}>
      {children}
      {task && (
        <Suspense fallback={null}>
          <TaskDetailModal task={task} isOpen onClose={closeTaskDetail} />
        </Suspense>
      )}
    </TaskDetailContext.Provider>
  );
};
