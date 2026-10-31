import { createContext, useContext } from "react";
import { Task } from "types";

export interface TaskDetailContextValue {
  openTaskDetail: (task: Task) => void;
  closeTaskDetail: () => void;
}

// Split out of TaskDetailContext.tsx so that file exports only the `TaskDetailProvider`
// component — react-refresh's fast-refresh can't hot-reload a file that exports both a
// component and non-component values (this context object + the hook below).
export const TaskDetailContext = createContext<TaskDetailContextValue | null>(null);

export const useTaskDetail = (): TaskDetailContextValue => {
  const ctx = useContext(TaskDetailContext);
  if (!ctx) {
    throw new Error("useTaskDetail must be used within a TaskDetailProvider");
  }
  return ctx;
};
