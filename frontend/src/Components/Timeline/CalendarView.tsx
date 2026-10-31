import React, { useMemo, useState, useRef } from "react";
import {
  Box,
  Flex,
  Text,
  HStack,
  IconButton,
  Button,
  Badge,
  Tooltip,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Portal,
  VStack,
  useToast,
} from "@chakra-ui/react";
import { FaChevronLeft, FaChevronRight } from "Utils/icons";
import { useAppDispatch, useAppSelector } from "app/hooks";
import { getLocalDateKey } from "Utils/scheduler";
import { getPriorityHex } from "Utils/priority";
import { taskColor } from "Utils/avatar";
import { Task } from "types";
import { getVisibleScope } from "Utils/orgTree";
import { updateTask } from "app/slices/scheduler.slice";
import { useUpdateTaskMutation } from "Services/user.api";
import SubtaskProgressPill from "Components/Timeline/SubtaskProgressPill";

interface CalendarViewProps {
  onEditTask: (task: Task) => void;
  filteredManagerId?: string;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MAX_CHIPS = 3; // per day cell before "+N more"

/** YYYY-MM-DD for a calendar cell built from plain Y/M/D (no tz conversion). */
const cellKey = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * A UTC instant that `getLocalDateKey` maps back onto the business-tz day `key`.
 * We scan the 24 UTC hours of that date and pick the first that lands on `key`,
 * so a drag-reschedule is correct regardless of the viewer's timezone.
 */
const isoForDayKey = (key: string): string => {
  for (let h = 6; h < 6 + 24; h++) {
    const hh = h % 24;
    const cand = new Date(`${key}T${String(hh).padStart(2, "0")}:00:00.000Z`);
    if (getLocalDateKey(cand) === key) return cand.toISOString();
  }
  return new Date(`${key}T12:00:00.000Z`).toISOString();
};

const isDone = (t: Task) =>
  ["done", "completed"].includes((t.task_status || "").toLowerCase());

const CalendarView: React.FC<CalendarViewProps> = ({
  onEditTask,
  filteredManagerId,
}) => {
  const { developers: allDevelopers, tasks, currentUser } = useAppSelector(
    (state) => state.scheduler,
  );
  const dispatch = useAppDispatch();
  const toast = useToast();
  const [updateTaskApi] = useUpdateTaskMutation();
  const dragId = useRef<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  // Same org-tree scoping as the timeline: self + recursive subtree.
  const visibleEmpIds = useMemo(() => {
    if (!currentUser) return new Set<string>();
    const visible = getVisibleScope(allDevelopers, currentUser, filteredManagerId);
    return new Set(
      allDevelopers.filter((d) => visible.has(d.emp_id)).map((d) => d.emp_id),
    );
  }, [allDevelopers, currentUser, filteredManagerId]);

  // Bucket visible tasks by their scheduled day (assigned date, else due date).
  const tasksByDay = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const t of tasks) {
      if (t.task_assigned_to && !visibleEmpIds.has(t.task_assigned_to)) continue;
      const raw = t.task_assigned_date || t.task_due_date;
      if (!raw) continue;
      const d = new Date(raw);
      if (isNaN(d.getTime())) continue;
      const key = getLocalDateKey(d);
      (map[key] ||= []).push(t);
    }
    // Stable order within a day: priority (P0 first) then name.
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => {
        const pa = (a.task_priority || "P4").toUpperCase();
        const pb = (b.task_priority || "P4").toUpperCase();
        return pa === pb
          ? (a.task_name || "").localeCompare(b.task_name || "")
          : pa.localeCompare(pb);
      });
    }
    return map;
  }, [tasks, visibleEmpIds]);

  const [viewDate, setViewDate] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const todayKey = getLocalDateKey(new Date());

  // 6-week grid starting on the Sunday on/before the 1st.
  const cells = useMemo(() => {
    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return {
        y: d.getFullYear(),
        m: d.getMonth(),
        d: d.getDate(),
        key: cellKey(d.getFullYear(), d.getMonth(), d.getDate()),
        inMonth: d.getMonth() === month,
      };
    });
  }, [year, month]);

  const goPrev = () => setViewDate(new Date(year, month - 1, 1));
  const goNext = () => setViewDate(new Date(year, month + 1, 1));
  const goToday = () => {
    const n = new Date();
    setViewDate(new Date(n.getFullYear(), n.getMonth(), 1));
  };

  const canModify = (t: Task) => {
    // Mirror the backend rule at a glance: assignee, or a manager scope holder (visible set).
    return (
      !!currentUser &&
      (t.task_assigned_to === currentUser.emp_id ||
        t.task_assigned_by === currentUser.emp_id ||
        (t.task_assigned_to ? visibleEmpIds.has(t.task_assigned_to) : true))
    );
  };

  const reschedule = async (task: Task, dayKey: string) => {
    const existingKey = task.task_assigned_date
      ? getLocalDateKey(new Date(task.task_assigned_date))
      : null;
    if (existingKey === dayKey) return; // no-op drop on same day
    if (isDone(task)) {
      toast({ title: "Completed tasks can't be rescheduled", status: "info", duration: 2500 });
      return;
    }
    if (!canModify(task)) {
      toast({ title: "Not allowed to reschedule this task", status: "warning", duration: 2500 });
      return;
    }
    const newIso = isoForDayKey(dayKey);
    const updated = { ...task, task_assigned_date: newIso };
    dispatch(updateTask(updated)); // optimistic
    try {
      const resp = await updateTaskApi(updated).unwrap();
      dispatch(updateTask(resp || updated));
      toast({ title: "Task rescheduled", status: "success", duration: 1800 });
    } catch {
      dispatch(updateTask(task)); // revert
      toast({ title: "Reschedule failed", status: "error", duration: 3000 });
    }
  };

  return (
    <Box bg="white" border="1px solid" borderColor="surface.border" borderRadius="14px" p={4}>
      {/* Header */}
      <Flex justify="space-between" align="center" mb={4} wrap="wrap" gap={2}>
        <HStack spacing={3}>
          <Text fontSize="lg" fontWeight={800} color="neutral.900">
            {MONTHS[month]} {year}
          </Text>
          <Button size="xs" variant="outline" onClick={goToday} borderRadius="8px">
            Today
          </Button>
        </HStack>
        <HStack spacing={1}>
          <IconButton aria-label="Previous month" icon={<FaChevronLeft />} size="sm" variant="ghost" onClick={goPrev} />
          <IconButton aria-label="Next month" icon={<FaChevronRight />} size="sm" variant="ghost" onClick={goNext} />
        </HStack>
      </Flex>

      {/* Weekday header */}
      <Flex>
        {WEEKDAYS.map((w) => (
          <Box key={w} flex="1" textAlign="center" pb={2}>
            <Text fontSize="xs" fontWeight={700} color="neutral.500" textTransform="uppercase">
              {w}
            </Text>
          </Box>
        ))}
      </Flex>

      {/* Day grid */}
      <Box border="1px solid" borderColor="surface.border" borderRadius="10px" overflow="hidden">
        {Array.from({ length: 6 }, (_, week) => (
          <Flex key={week} borderBottom={week < 5 ? "1px solid" : "none"} borderColor="surface.border">
            {cells.slice(week * 7, week * 7 + 7).map((c, i) => {
              const dayTasks = tasksByDay[c.key] || [];
              const isToday = c.key === todayKey;
              const isDropTarget = dragOverKey === c.key;
              return (
                <Box
                  key={c.key}
                  flex="1"
                  minH="112px"
                  borderRight={i < 6 ? "1px solid" : "none"}
                  borderColor="surface.border"
                  bg={isDropTarget ? "brand.50" : c.inMonth ? "white" : "neutral.50"}
                  p={1.5}
                  transition="background 0.12s"
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragOverKey !== c.key) setDragOverKey(c.key);
                  }}
                  onDragLeave={() => setDragOverKey((k) => (k === c.key ? null : k))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverKey(null);
                    const id = dragId.current;
                    dragId.current = null;
                    if (!id) return;
                    const task = tasks.find((t) => t.id === id);
                    if (task) reschedule(task, c.key);
                  }}
                >
                  <Flex justify="space-between" align="center" mb={1}>
                    <Text
                      fontSize="xs"
                      fontWeight={isToday ? 800 : 600}
                      color={c.inMonth ? (isToday ? "white" : "neutral.700") : "neutral.500"}
                      bg={isToday ? "brand.600" : "transparent"}
                      borderRadius="full"
                      w="20px"
                      h="20px"
                      lineHeight="20px"
                      textAlign="center"
                    >
                      {c.d}
                    </Text>
                    {dayTasks.length > 0 && (
                      <Text fontSize="10px" color="neutral.500" fontWeight={600}>
                        {dayTasks.length}
                      </Text>
                    )}
                  </Flex>

                  {dayTasks.slice(0, MAX_CHIPS).map((t) => (
                    <Tooltip
                      key={t.id}
                      label={`${t.task_name}${t.task_priority ? ` · ${t.task_priority}` : ""}`}
                      openDelay={400}
                      fontSize="xs"
                    >
                      <Box
                        draggable={!isDone(t)}
                        onDragStart={() => {
                          dragId.current = t.id;
                        }}
                        onClick={() => onEditTask(t)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onEditTask(t);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        aria-label={t.task_name}
                        cursor="pointer"
                        mb="3px"
                        px={1.5}
                        py="2px"
                        borderRadius="5px"
                        borderLeft="3px solid"
                        borderLeftColor={getPriorityHex(t.task_priority)}
                        bg={`${taskColor(t.id)}22`}
                        opacity={isDone(t) ? 0.55 : 1}
                        _hover={{ bg: `${taskColor(t.id)}33` }}
                        _focusVisible={{ outline: "2px solid", outlineColor: "blue.400", outlineOffset: "1px" }}
                      >
                        <Flex align="center" gap={1}>
                          <Text
                            fontSize="11px"
                            fontWeight={600}
                            color="neutral.800"
                            noOfLines={1}
                            flex={1}
                            minW={0}
                            textDecoration={isDone(t) ? "line-through" : "none"}
                          >
                            {t.task_name}
                          </Text>
                          <SubtaskProgressPill task={t} variant="inline" />
                        </Flex>
                      </Box>
                    </Tooltip>
                  ))}

                  {/* Overflow affordance (item 4, scale-gaps-plan.md §B.3) — a busy day at org
                      scale can hold dozens of tasks; cap the visible chips and reveal the rest
                      in a popover instead of rendering (or silently clipping) them all. */}
                  {dayTasks.length > MAX_CHIPS && (
                    <Popover placement="right-start" isLazy>
                      <PopoverTrigger>
                        <Badge
                          fontSize="10px"
                          colorScheme="gray"
                          variant="subtle"
                          borderRadius="full"
                          cursor="pointer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          +{dayTasks.length - MAX_CHIPS} more
                        </Badge>
                      </PopoverTrigger>
                      <Portal>
                        <PopoverContent
                          w="260px"
                          boxShadow="xl"
                          borderRadius="lg"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <PopoverArrow />
                          <PopoverBody maxH="280px" overflowY="auto">
                            <Text
                              fontSize="xs"
                              fontWeight={700}
                              color="neutral.500"
                              textTransform="uppercase"
                              mb={2}
                            >
                              {dayTasks.length} task{dayTasks.length === 1 ? "" : "s"} ·{" "}
                              {new Date(c.y, c.m, c.d).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                              })}
                            </Text>
                            <VStack align="stretch" spacing={1}>
                              {dayTasks.map((t) => (
                                <Flex
                                  key={t.id}
                                  align="center"
                                  gap={2}
                                  px={2}
                                  py={1.5}
                                  borderRadius="md"
                                  cursor="pointer"
                                  role="button"
                                  tabIndex={0}
                                  aria-label={`Open ${t.task_name}`}
                                  _hover={{ bg: "neutral.50" }}
                                  onClick={() => onEditTask(t)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      onEditTask(t);
                                    }
                                  }}
                                  _focusVisible={{
                                    outline: "2px solid",
                                    outlineColor: "blue.400",
                                    outlineOffset: "-2px",
                                  }}
                                >
                                  <Box
                                    w="6px"
                                    h="6px"
                                    borderRadius="full"
                                    bg={getPriorityHex(t.task_priority)}
                                    flexShrink={0}
                                  />
                                  <Text
                                    fontSize="xs"
                                    color="neutral.800"
                                    noOfLines={1}
                                    flex={1}
                                    minW={0}
                                    textDecoration={isDone(t) ? "line-through" : "none"}
                                  >
                                    {t.task_name}
                                  </Text>
                                  <SubtaskProgressPill task={t} variant="inline" />
                                </Flex>
                              ))}
                            </VStack>
                          </PopoverBody>
                        </PopoverContent>
                      </Portal>
                    </Popover>
                  )}
                </Box>
              );
            })}
          </Flex>
        ))}
      </Box>

      <Text mt={3} fontSize="xs" color="neutral.500">
        Drag a task to another day to reschedule. Click a task to open it.
      </Text>
    </Box>
  );
};

export default CalendarView;
