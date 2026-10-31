import React, { useMemo, useState, useEffect, useRef } from "react";
import {
  Box,
  Flex,
  Text,
  IconButton,
  useColorModeValue,
  VStack,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverBody,
  PopoverArrow,
  Badge,
  HStack,
  Divider,
  Portal,
  Button,
  useToast,
  Collapse,
  Switch,
  Tooltip,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalCloseButton,
  ModalBody,
  Image,
} from "@chakra-ui/react";
import {
  FaChevronLeft,
  FaChevronRight,
  FaChevronDown,
  FaClock,
  FaCalendarAlt,
  FaCheck,
  FaEdit,
  FaTrash,
  FaSearchPlus,
  FaTimes,
  FaPause,
  FaAngleDoubleLeft,
  FaAngleDoubleRight,
} from "Utils/icons";
import { useAppDispatch, useAppSelector } from "app/hooks";
import {
  calculateSchedule,
  getLocalDateKey,
  zonedHourOfDay,
} from "Utils/scheduler";
import { formatDuration } from "Utils/common";
import { getPriorityColor, getPriorityHex } from "Utils/priority";
import { taskColor } from "Utils/avatar";
import { Task, Employee, TaskBlock } from "types";
import { getVisibleScope } from "Utils/orgTree";
import {
  updateTask,
  deleteTask as deleteTaskAction,
} from "app/slices/scheduler.slice";
import {
  useUpdateTaskMutation,
  useDeleteTaskMutation,
} from "Services/user.api";
import { UserHierarchyPopover } from "Components/UserHierarchyPopover";
import SessionCorrectionControls from "Components/Timeline/SessionCorrectionControls";
import UserAvatar from "Components/UserAvatar";
import AttachmentThumbnails from "Components/Timeline/AttachmentThumbnails";
import SubtaskProgressPill from "Components/Timeline/SubtaskProgressPill";
import MemberSearchFilter from "Components/Timeline/MemberSearchFilter";
import SavedTeamViewsPopover from "Components/Timeline/SavedTeamViewsPopover";
import { getApiErrorMessage, ApiError } from "Services/baseQuery";

interface TimelineViewProps {
  onEditTask: (task: Task) => void;
  filteredManagerId?: string;
}

const TimelineView: React.FC<TimelineViewProps> = ({
  onEditTask,
  filteredManagerId,
}) => {
  const {
    config,
    developers: allDevelopers,
    tasks,
    currentUser,
  } = useAppSelector((state) => state.scheduler);
  const dispatch = useAppDispatch();
  const toast = useToast();
  const [updateTaskApi] = useUpdateTaskMutation();
  const [deleteTaskApi] = useDeleteTaskMutation();
  const popoverBorderColor = useColorModeValue("gray.100", "gray.700");
  const popoverBg = useColorModeValue("white", "gray.800");

  const scopedDevelopers = useMemo(() => {
    if (!currentUser) return [];
    // Org-tree scope: self + recursive subtree. Task assignability is open to every rank now
    // (see permissions.py), so anyone in scope gets a row, not just rank < EM.
    const visible = getVisibleScope(allDevelopers, currentUser, filteredManagerId);
    return allDevelopers.filter((d) => visible.has(d.emp_id));
  }, [allDevelopers, currentUser, filteredManagerId]);

  // Member search-filter (scale-gaps-plan.md §B.1): narrows the org-tree-scoped set above down
  // to a hand-picked (possibly cross-functional) group of people, on top of — not instead of —
  // org-tree scoping + the "All Members" manager dropdown. Empty selection = show the full
  // org-tree-scoped set, unchanged.
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const developers = useMemo(() => {
    if (selectedMemberIds.length === 0) return scopedDevelopers;
    const selectedSet = new Set(selectedMemberIds);
    return scopedDevelopers.filter((d) => selectedSet.has(d.emp_id));
  }, [scopedDevelopers, selectedMemberIds]);

  // Default date logic: If now > EndHour, show Tomorrow.
  // Default date logic: If now > EndHour, show Tomorrow.
  const [currentDate, setCurrentDate] = useState(() => {
    // Force reset to Today (or Tomorrow if late), ignoring LocalStorage for now
    // This fixes the issue where users are stuck on an old date (e.g. 15 Jan)
    const now = new Date();
    const currentHour = zonedHourOfDay(now);
    if (currentHour >= config.endHour) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow;
    }
    return now;
  });


  const [tick, setTick] = useState(0);
  const [expandedHour, setExpandedHour] = useState<number | null>(null);
  // Attachment lightbox lives outside every hover Popover's subtree — a Popover's own
  // mouseleave-driven auto-close (500ms after the pointer stops overlapping PopoverContent, which
  // happens the instant this overlay steals the hit-test) would otherwise unmount it immediately.
  const [previewAttachment, setPreviewAttachment] = useState<{ data: string; filename?: string } | null>(null);
  // Faint "planned schedule" ghost track behind the actual ribbon (am-I-on-schedule?).
  const [showPlan, setShowPlan] = useState(false);
  // Per-user row expansion (collapsed activity ribbon ↔ per-task swimlanes). Keyed by emp_id.
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const toggleRow = (empId: string) =>
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(empId)) {
        next.delete(empId);
      } else {
        next.add(empId);
      }
      return next;
    });

  // Update tick every minute to refresh schedule (extend overdue tasks)
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Memoize schedule calculation
  const schedule = useMemo(() => {
    // Start Date:
    // If viewing the past, start simulation from that date to show history/schedule.
    // If viewing the future, start from Today to correctly project the current backlog.
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const viewDate = new Date(currentDate);
    viewDate.setHours(0, 0, 0, 0);

    // Use the earlier of the two
    const simStartDate = viewDate < startOfToday ? viewDate : startOfToday;

    // Filter tasks for Timeline: Only show "in-progress" and "done"
    // The user requirement: "now in timeline only in progress or done task wil be listed notign else"
    // A task's CURRENT status gates whether it shows as active/parked today, but must never gate
    // whether its PAST work sessions still render on the day they actually happened — e.g. the
    // overdue sweeper can flip a task to "backlog" days later, which used to make its real,
    // already-worked history vanish retroactively from every day's view, including yesterday's.
    const timelineTasks = tasks.filter(
      (t) =>
        t.task_status === "in-progress" ||
        t.task_status === "done" ||
        t.task_status === "todo" ||
        t.task_status === "on-hold" ||
        (t.task_sessions && t.task_sessions.length > 0),
    );

    // actualOnly: the timeline shows real work history (session segments), not the
    // planned-work simulation — see scheduler.ts.
    return calculateSchedule(timelineTasks, developers, config, simStartDate, {
      actualOnly: true,
    });
  }, [tasks, developers, config, tick, currentDate]);

  // Planned schedule (full simulation) — only computed when the ghost overlay is toggled on.
  const plannedSchedule = useMemo(() => {
    if (!showPlan) return {} as typeof schedule;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const viewDate = new Date(currentDate);
    viewDate.setHours(0, 0, 0, 0);
    const simStartDate = viewDate < startOfToday ? viewDate : startOfToday;
    // A task's CURRENT status gates whether it shows as active/parked today, but must never gate
    // whether its PAST work sessions still render on the day they actually happened — e.g. the
    // overdue sweeper can flip a task to "backlog" days later, which used to make its real,
    // already-worked history vanish retroactively from every day's view, including yesterday's.
    const timelineTasks = tasks.filter(
      (t) =>
        t.task_status === "in-progress" ||
        t.task_status === "done" ||
        t.task_status === "todo" ||
        t.task_status === "on-hold" ||
        (t.task_sessions && t.task_sessions.length > 0),
    );
    return calculateSchedule(timelineTasks, developers, config, simStartDate);
  }, [showPlan, tasks, developers, config, tick, currentDate]);

  const timeSlots = useMemo(() => {
    if (expandedHour !== null) {
      // Zoomed View: Return 10-minute intervals
      return [0, 10, 20, 30, 40, 50];
    }
    const slots = [];
    for (let i = config.startHour; i < config.endHour; i++) {
      slots.push(i);
    }
    return slots;
  }, [config, expandedHour]);

  // Framer Motion Components
  // const MotionBox = motion(Box); remove unused var

  const handleNextDay = () => {
    const next = new Date(currentDate);
    next.setDate(next.getDate() + 1);
    setCurrentDate(next);
  };

  const handlePrevDay = () => {
    const prev = new Date(currentDate);
    prev.setDate(prev.getDate() - 1);
    setCurrentDate(prev);
  };

  const handlePickFromTimeline = async (task: Task) => {
    try {
      // Backend `start_new_session` auto-holds any currently-active task for this user and opens
      // a fresh session — it is the single source of truth for preemption. We no longer pre-pause
      // on the client (that PUT set the previous task to "todo", the wrong bucket, and blocked the
      // backend auto-hold from firing).
      // Optimistic preempt: reflect the auto-hold + the new active task locally so the ribbon
      // updates instantly; the `["Task"]` refetch then reconciles the authoritative state.
      const active = tasks.find(
        (t) =>
          t.task_assigned_to === task.task_assigned_to &&
          t.id !== task.id &&
          ["in-progress", "in progress"].includes(
            (t.task_status || "").toLowerCase(),
          ),
      );
      if (active) dispatch(updateTask({ ...active, task_status: "on-hold" }));
      dispatch(updateTask({ ...task, task_status: "in-progress" }));

      const resp = await updateTaskApi({
        ...task,
        task_status: "in-progress",
      }).unwrap();
      dispatch(updateTask(resp || { ...task, task_status: "in-progress" }));
      toast({
        title: "Task Picked",
        description: `${task.task_name} is now in progress.`,
        status: "success",
        duration: 3000,
        isClosable: true,
      });
    } catch {
      toast({ title: "Error updating task", status: "error" });
    }
  };

  const handleCompleteTask = async (task: Task) => {
    // Enforce sequential completion (P0 or currently-active bypass). Re-based on the TASK LIST,
    // not the schedule: the actual-only timeline no longer holds planned/not-started work, so the
    // old "first pending block" lookup would misfire.
    const isPriorityOrActive =
      task.task_priority === "P0" || task.task_status === "in-progress";

    const assigneeId = task.task_assigned_to;
    if (assigneeId && !isPriorityOrActive) {
      const pending = tasks
        .filter(
          (t) =>
            t.task_assigned_to === assigneeId &&
            !["done", "completed", "backlog"].includes(
              (t.task_status || "").toLowerCase(),
            ),
        )
        .sort((a, b) => {
          const ta = new Date(
            a.task_assigned_date || a.task_created_at || 0,
          ).getTime();
          const tb = new Date(
            b.task_assigned_date || b.task_created_at || 0,
          ).getTime();
          return ta - tb;
        });
      const first = pending[0];
      if (first && first.id !== task.id) {
        toast({
          title: "Cannot Complete Task",
          description: `Please complete '${first.task_name}' first, or increase this task's priority.`,
          status: "warning",
          duration: 4000,
          isClosable: true,
        });
        return;
      }
    }

    try {
      // Status-only: the backend closes the open session and recomputes time_spent + completed_at.
      const resp = await updateTaskApi({
        ...task,
        task_status: "done",
      }).unwrap();
      dispatch(updateTask(resp || { ...task, task_status: "done" }));
      toast({
        title: "Task Completed",
        description: `${task.task_name} marked as done.`,
        status: "success",
        duration: 3000,
        isClosable: true,
      });
    } catch (error) {
      toast({
        title: "Cannot complete task",
        description: getApiErrorMessage(error, "Failed to update task status on server."),
        status: "error",
        duration: 4000,
        isClosable: true,
      });
    }
  };

  const handleHoldTask = async (task: Task) => {
    try {
      // Status-only: the backend closes the open session (labeled "on-hold") and recomputes
      // time_spent authoritatively. No client-side time math (it drifted from the server value).
      const resp = await updateTaskApi({
        ...task,
        task_status: "on-hold",
      }).unwrap();
      dispatch(updateTask(resp || { ...task, task_status: "on-hold" }));
      toast({
        title: "Task On Hold",
        description: "Task paused and moved to pending list.",
        status: "warning",
        duration: 3000,
        isClosable: true,
      });
    } catch {
      toast({
        title: "Error",
        description: "Failed to update task status.",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    }
  };

  const handleDeleteTask = async (task: Task) => {
    if (!window.confirm(`Delete task "${task.task_name}"?`)) return;
    try {
      await deleteTaskApi(task.id).unwrap();
      dispatch(deleteTaskAction(task.id));
      toast({ title: "Task deleted", status: "success" });
    } catch (err) {
      const message = getApiErrorMessage(err);
      // 409 = it has subtasks (delete_task's own guard). Offer the cascade retry here too,
      // same as the task-detail view, instead of leaving the block as a dead end.
      if (Number((err as ApiError)?.status) === 409) {
        if (window.confirm(`${message}\n\nDelete this task AND its subtask(s) too?`)) {
          try {
            await deleteTaskApi({ taskId: task.id, cascade: true }).unwrap();
            dispatch(deleteTaskAction(task.id));
            toast({ title: "Task and its subtasks deleted", status: "success" });
          } catch (err2) {
            toast({
              title: "Failed to delete task",
              description: getApiErrorMessage(err2),
              status: "error",
            });
          }
        }
        return;
      }
      toast({ title: "Failed to delete task", description: message, status: "error" });
    }
  };

  // Format an ISO timestamp as a business-tz clock time (e.g. "2:30 PM").
  const fmtClock = (iso?: string) => {
    if (!iso) return "";
    const h = zonedHourOfDay(new Date(iso));
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    const suffix = hh % 24 < 12 ? "AM" : "PM";
    const disp = hh % 12 === 0 ? 12 : hh % 12;
    return `${disp}:${String(mm).padStart(2, "0")} ${suffix}`;
  };

  const todayStr = getLocalDateKey(currentDate);

  // ── Per-developer schedule memoization ──────────────────────────────────────
  // The minute `tick` rebuilds the whole `schedule` object, but for a developer with
  // no OPEN session the blocks are byte-identical tick-to-tick. Reuse the previous
  // array reference for such developers so the per-row derivation below can be cached
  // and skipped — the big win for large teams (most rows are idle at any instant).
  const scheduleRefCache = useRef<Record<string, { json: string; blocks: TaskBlock[] }>>({});
  const stableSchedule = useMemo(() => {
    const out: Record<string, TaskBlock[]> = {};
    const cache = scheduleRefCache.current;
    for (const empId of Object.keys(schedule)) {
      const blocks = schedule[empId] || [];
      const json = JSON.stringify(blocks);
      const prev = cache[empId];
      if (prev && prev.json === json) {
        out[empId] = prev.blocks; // unchanged → keep stable reference
      } else {
        cache[empId] = { json, blocks };
        out[empId] = blocks;
      }
    }
    for (const empId of Object.keys(cache)) if (!(empId in schedule)) delete cache[empId];
    return out;
  }, [schedule]);

  // Derived per-row data (today's blocks, parked tasks, lane order, carry-over flags,
  // ghost bars). Cached per developer keyed on the identity of its inputs, so a tick that
  // leaves a developer's blocks/tasks untouched reuses the previous derivation.
  type RowData = {
    dayBlocks: TaskBlock[];
    myTasks: Task[];
    parkedTasks: Task[];
    laneTaskIds: string[];
    hasEarlier: boolean;
    hasLater: boolean;
    ghostBlocks: TaskBlock[];
  };
  const EMPTY_BLOCKS = useRef<TaskBlock[]>([]).current;
  const rowDataCache = useRef<
    Map<string, {
      blocksRef: TaskBlock[]; ghostRef: TaskBlock[]; tasksRef: Task[];
      todayStr: string; showPlan: boolean; data: RowData;
    }>
  >(new Map());
  const rowDataByDev = useMemo(() => {
    const out: Record<string, RowData> = {};
    const cache = rowDataCache.current;
    const seen = new Set<string>();
    for (const dev of developers) {
      seen.add(dev.emp_id);
      const allBlocks = stableSchedule[dev.emp_id] || EMPTY_BLOCKS;
      const ghostAll = showPlan ? plannedSchedule[dev.emp_id] || EMPTY_BLOCKS : EMPTY_BLOCKS;
      const prev = cache.get(dev.emp_id);
      if (
        prev &&
        prev.blocksRef === allBlocks &&
        prev.ghostRef === ghostAll &&
        prev.tasksRef === tasks &&
        prev.todayStr === todayStr &&
        prev.showPlan === showPlan
      ) {
        out[dev.emp_id] = prev.data;
        continue;
      }
      const dayBlocks = allBlocks
        .filter((b) => b.date === todayStr)
        .sort((a, b) => a.startTime - b.startTime);
      const myTasks = tasks.filter((t) => t.task_assigned_to === dev.emp_id);
      const blockTaskIds = new Set(dayBlocks.map((b) => b.taskId));
      const parkedTasks = myTasks.filter(
        (t) =>
          !blockTaskIds.has(t.id) &&
          ["on-hold", "todo", "backlog"].includes((t.task_status || "").toLowerCase()),
      );
      const laneTaskIds: string[] = [];
      dayBlocks.forEach((b) => {
        if (!laneTaskIds.includes(b.taskId)) laneTaskIds.push(b.taskId);
      });
      const hasEarlier = allBlocks.some((b) => b.date < todayStr);
      const hasLater = allBlocks.some((b) => b.date > todayStr);
      const ghostBlocks = ghostAll.filter((b) => b.date === todayStr);
      const data: RowData = { dayBlocks, myTasks, parkedTasks, laneTaskIds, hasEarlier, hasLater, ghostBlocks };
      cache.set(dev.emp_id, {
        blocksRef: allBlocks, ghostRef: ghostAll, tasksRef: tasks, todayStr, showPlan, data,
      });
      out[dev.emp_id] = data;
    }
    for (const id of Array.from(cache.keys())) if (!seen.has(id)) cache.delete(id);
    return out;
  }, [stableSchedule, plannedSchedule, tasks, developers, todayStr, showPlan, EMPTY_BLOCKS]);

  // Live "current time" indicator — only when viewing today, within business hours, not
  // zoomed. `tick` (updated every 60s elsewhere) drives the re-render so the line moves.
  void tick;
  const _now = new Date();
  const _nowHours = zonedHourOfDay(_now);
  const isTodayView = getLocalDateKey(currentDate) === getLocalDateKey(_now);
  const showNowLine =
    isTodayView &&
    expandedHour === null &&
    _nowHours >= config.startHour &&
    _nowHours <= config.endHour;
  const nowLeftPct =
    ((_nowHours - config.startHour) / (config.endHour - config.startHour)) * 100;

  // "10 AM" / "12 PM" / "3 PM"
  const formatHour = (h: number) => {
    const suffix = h % 24 < 12 ? "AM" : "PM";
    const disp = h % 12 === 0 ? 12 : h % 12;
    return `${disp} ${suffix}`;
  };

  // ── actual-history render helpers ───────────────────────────────────────────
  const totalVisualHours = config.endHour - config.startHour;

  // Grid-line background, reused by the ribbon and every swimlane.
  const gridLinesEl = (
    <Flex
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      zIndex={0}
      pointerEvents="none"
    >
      {timeSlots.map((_, i) => (
        <Box
          key={i}
          flex={1}
          borderLeft="1px solid"
          borderColor="neutral.100"
          h="100%"
        />
      ))}
      <Box
        borderLeft="1px solid"
        borderColor="neutral.100"
        h="100%"
        position="absolute"
        right={0}
        top={0}
      />
    </Flex>
  );

  const statusDotColor = (status?: string) => {
    switch ((status || "").toLowerCase()) {
      case "on-hold":
        return "yellow.400";
      case "backlog":
        return "red.400";
      default:
        return "blue.400";
    }
  };

  // Full hover-popover (task detail + actions), shared by ribbon/lane segments and parked chips.
  const taskActionPopover = (
    task: Task,
    dev: Employee,
    key: string,
    trigger: React.ReactElement,
  ) => {
    const isCompleted = task.task_status === "done";
    const isParked = ["backlog", "on-hold", "todo"].includes(
      (task.task_status || "").toLowerCase(),
    );
    return (
      <Popover
        key={key}
        trigger="hover"
        placement="top"
        openDelay={300}
        closeDelay={500}
        isLazy
      >
        <PopoverTrigger>{trigger}</PopoverTrigger>
        <Portal>
          <PopoverContent
            width="320px"
            boxShadow="2xl"
            borderRadius="xl"
            borderColor={popoverBorderColor}
            bg={popoverBg}
            overflow="hidden"
            _focus={{ outline: "none" }}
          >
            <PopoverArrow />
            <PopoverBody p={0}>
              <Box
                h="4px"
                width="100%"
                bg={getPriorityHex(task.task_priority as string)}
              />
              <VStack align="stretch" spacing={3} p={4}>
                <Flex justify="space-between" align="start">
                  <Text fontWeight="bold" fontSize="md" lineHeight="shorter">
                    {task.task_name}
                  </Text>
                  {task.task_priority && (
                    <Badge
                      colorScheme={getPriorityColor(task.task_priority as string)}
                      variant="subtle"
                      borderRadius="full"
                      px={2}
                    >
                      {task.task_priority}
                    </Badge>
                  )}
                </Flex>

                {task.task_description && (
                  <Text fontSize="sm" color="gray.600" noOfLines={2}>
                    {task.task_description}
                  </Text>
                )}

                <Divider />

                <VStack align="stretch" spacing={2}>
                  <Flex align="center" gap={2}>
                    <UserAvatar size="xs" name={dev.emp_name} photo={dev.profile_pic} />
                    <Text fontSize="sm" fontWeight="medium" color="gray.700">
                      {dev.emp_name}
                    </Text>
                  </Flex>

                  <HStack spacing={4}>
                    <Flex align="start" direction="column" gap={0}>
                      <Flex align="center" gap={1.5}>
                        <Box as={FaClock} color="gray.600" />
                        <Text fontSize="xs" color="gray.600" fontWeight="bold">
                          Planned: {formatDuration(task.task_duration)}
                        </Text>
                      </Flex>
                      <Flex align="center" gap={1.5} ml={5}>
                        <Text
                          fontSize="xs"
                          color={isCompleted ? "green.600" : "gray.500"}
                        >
                          Actual:{" "}
                          {formatDuration(
                            task.time_spent ||
                              (isCompleted ? task.task_duration : 0),
                          )}
                        </Text>
                      </Flex>
                    </Flex>
                    {task.task_due_date && (
                      <Flex align="center" gap={1.5}>
                        <Box as={FaCalendarAlt} color="gray.600" />
                        <Text fontSize="xs" color="gray.600">
                          {new Date(task.task_due_date).toLocaleDateString()}
                        </Text>
                      </Flex>
                    )}
                  </HStack>
                </VStack>

                {task.task_tags && (
                  <Flex wrap="wrap" gap={2} mt={1}>
                    {task.task_tags.split(",").map((tag, i) => (
                      <Badge
                        key={i}
                        variant="outline"
                        colorScheme="purple"
                        fontSize="xx-small"
                        px={1.5}
                        py={0.5}
                        borderRadius="md"
                      >
                        {tag.trim()}
                      </Badge>
                    ))}
                  </Flex>
                )}

                <AttachmentThumbnails taskId={task.id} withDivider onPreview={setPreviewAttachment} />

                {task.task_sessions && task.task_sessions.length > 0 && (
                  <>
                    <Divider />
                    <Box>
                      <Text
                        fontSize="xs"
                        fontWeight={700}
                        color="gray.600"
                        mb={1}
                        textTransform="uppercase"
                        letterSpacing="0.04em"
                      >
                        Work sessions
                      </Text>
                      <VStack align="stretch" spacing={1} maxH="160px" overflowY="auto">
                        {task.task_sessions.map((s, i) => (
                          <SessionCorrectionControls
                            key={i}
                            task={task}
                            session={s}
                            fmtClock={fmtClock}
                            statusDotColor={statusDotColor}
                          />
                        ))}
                      </VStack>
                    </Box>
                  </>
                )}

                <Divider />

                <Box width="100%">
                  {isParked ? (
                    <>
                      <Button
                        leftIcon={<FaCheck />}
                        size="sm"
                        colorScheme="green"
                        w="100%"
                        mt={2}
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePickFromTimeline(task);
                        }}
                      >
                        {task.task_status === "on-hold"
                          ? "Resume Task"
                          : "Pick Task"}
                      </Button>
                      <IconButton
                        aria-label="Delete"
                        icon={<FaTrash />}
                        size="sm"
                        colorScheme="red"
                        variant="ghost"
                        width="100%"
                        mt={1}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteTask(task);
                        }}
                      />
                    </>
                  ) : isCompleted ? (
                    <Button
                      leftIcon={<FaTrash />}
                      size="sm"
                      colorScheme="red"
                      variant="ghost"
                      width="100%"
                      mt={2}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteTask(task);
                      }}
                    >
                      Delete
                    </Button>
                  ) : (
                    <HStack spacing={2} pt={2}>
                      <Button
                        leftIcon={<FaEdit />}
                        size="sm"
                        variant="outline"
                        flex={1}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditTask(task);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        leftIcon={<FaPause />}
                        size="sm"
                        colorScheme="red"
                        flex={1}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleHoldTask(task);
                        }}
                      >
                        Hold
                      </Button>
                      <Button
                        leftIcon={<FaCheck />}
                        size="sm"
                        colorScheme="green"
                        flex={1}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCompleteTask(task);
                        }}
                      >
                        Done
                      </Button>
                      <IconButton
                        aria-label="Delete"
                        icon={<FaTrash />}
                        size="sm"
                        colorScheme="red"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteTask(task);
                        }}
                      />
                    </HStack>
                  )}
                </Box>
              </VStack>
            </PopoverBody>
          </PopoverContent>
        </Portal>
      </Popover>
    );
  };

  // One work-session segment (ribbon or swimlane). Geometry from the block's real
  // start/end; solid fill colored by TASK (so same-priority neighbors stay distinct);
  // priority is the left-border accent; the open/live segment gets a now-dot.
  const renderSegment = (block: TaskBlock, dev: Employee, key: string) => {
    const task = tasks.find((t) => t.id === block.taskId);
    if (!task) return null;

    let left: number;
    let width: number;
    if (expandedHour !== null) {
      const vStart = Math.max(block.startTime, expandedHour);
      const vEnd = Math.min(block.endTime, expandedHour + 1);
      if (vStart >= vEnd) return null; // segment not in this hour
      width = (vEnd - vStart) * 100;
      left = (vStart - expandedHour) * 100;
    } else {
      left = (block.startTime - config.startHour) * (100 / totalVisualHours);
      width = (block.endTime - block.startTime) * (100 / totalVisualHours);
    }
    if (left + width < 0 || left > 100) return null; // out of view

    const isCompleted = task.task_status === "done";
    const fill = taskColor(task.id);
    const accent = getPriorityHex(task.task_priority as string);
    const clampedLeft = Math.max(0, left);
    const clampedWidth = Math.min(100 - clampedLeft, width);
    const segLabel = `${task.task_name}${
      task.task_priority ? ` (${task.task_priority})` : ""
    } — ${task.task_status}${block.isLive ? ", in progress now" : ""}`;

    const trigger = (
      <Box
        role="button"
        tabIndex={0}
        aria-label={segLabel}
        title={segLabel}
        position="absolute"
        left={`${clampedLeft}%`}
        width={`${clampedWidth}%`}
        top="12%"
        h="76%"
        minW="5px"
        overflow="hidden"
        bg={fill}
        opacity={isCompleted ? 0.68 : 1}
        borderLeft="4px solid"
        borderLeftColor={accent}
        borderRadius="md"
        boxShadow="0 1px 2px rgba(15,23,42,0.10)"
        cursor="pointer"
        onClick={(e) => {
          e.stopPropagation();
          onEditTask(task);
        }}
        onKeyDown={(e) => {
          // Plain <div role="button"> doesn't get free Enter/Space activation the way a
          // real <button> does, so wire it up manually.
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onEditTask(task);
          }
        }}
        transition="all 0.2s"
        _focusVisible={{
          outline: "2px solid",
          outlineColor: "blue.400",
          outlineOffset: "1px",
        }}
        _hover={{
          transform: "translateY(-1px)",
          zIndex: 10,
          boxShadow: "0 6px 16px rgba(15,23,42,0.18)",
        }}
      >
        {block.isLive && (
          <Box
            position="absolute"
            top="50%"
            right="5px"
            transform="translateY(-50%)"
            w="8px"
            h="8px"
            borderRadius="full"
            bg="white"
            boxShadow="0 0 0 3px rgba(255,255,255,0.6)"
            zIndex={2}
          />
        )}
        {/* Story progress corner badge (item 1, scale-gaps-plan.md §B.3) — only for stories
            (subtask_total > 0); the component itself no-ops for a leaf task. */}
        <SubtaskProgressPill task={task} variant="corner" />
        <Flex
          position="relative"
          zIndex={1}
          h="100%"
          align="center"
          gap={1.5}
          px={2}
        >
          {isCompleted && (
            <Box
              as={FaCheck}
              color="whiteAlpha.900"
              boxSize="10px"
              flexShrink={0}
            />
          )}
          <Text fontSize="xs" fontWeight={700} noOfLines={1} color="white">
            {task.task_name}
          </Text>
        </Flex>
      </Box>
    );

    return taskActionPopover(task, dev, key, trigger);
  };

  // Faint dashed "planned reservation" bar drawn behind the actual ribbon (plan overlay).
  const renderGhost = (block: TaskBlock, key: string) => {
    if (expandedHour !== null) return null; // keep the zoom view clean
    const left = (block.startTime - config.startHour) * (100 / totalVisualHours);
    const width = (block.endTime - block.startTime) * (100 / totalVisualHours);
    if (left + width < 0 || left > 100) return null;
    const cl = Math.max(0, left);
    const cw = Math.min(100 - cl, width);
    return (
      <Box
        key={key}
        position="absolute"
        left={`${cl}%`}
        width={`${cw}%`}
        top="22%"
        h="56%"
        minW="3px"
        borderRadius="sm"
        border="1px dashed"
        borderColor="neutral.300"
        bg="blackAlpha.50"
        pointerEvents="none"
        zIndex={0}
      />
    );
  };

  return (
    <>
    <Box
      p={6}
      bg="surface.card"
      border="1px solid"
      borderColor="surface.border"
      borderRadius="card"
      boxShadow="card"
      overflow="hidden"
    >
      <Flex justify="space-between" align="center" mb={6}>
        <Text fontSize="lg" fontWeight={700} color="neutral.900">
          Schedule
        </Text>
        <Flex align="center" gap={2}>
          <IconButton
            aria-label="Previous Day"
            icon={<FaChevronLeft />}
            onClick={handlePrevDay}
            variant="ghost"
            size="sm"
          />
          <Text fontSize="sm" fontWeight={600} color="neutral.700" minW="130px" textAlign="center">
            {currentDate.toLocaleDateString(undefined, {
              weekday: "long",
              month: "short",
              day: "numeric",
            })}
          </Text>
          <IconButton
            aria-label="Next Day"
            icon={<FaChevronRight />}
            onClick={handleNextDay}
            isDisabled={(() => {
              const now = new Date();
              const viewDate = new Date(currentDate);
              // Disable if View Date is Today (cannot go to Tomorrow yet)
              // Check if Today is same as View Date
              const isToday = viewDate.toDateString() === now.toDateString();
              // Or if View Date is already in future (shouldn't happen with this logic but safe guard)
              if (viewDate > now) return true;

              return isToday;
            })()}
            variant="ghost"
            size="sm"
          />
        </Flex>
      </Flex>

      {/* Member search-filter + saved team views (scale-gaps-plan.md §B.1/§B.2) */}
      <Flex justify="space-between" align="center" mb={4} wrap="wrap" gap={3}>
        <MemberSearchFilter
          members={scopedDevelopers}
          selectedIds={selectedMemberIds}
          onChange={setSelectedMemberIds}
        />
        <SavedTeamViewsPopover
          empId={currentUser?.emp_id}
          selectedMemberIds={selectedMemberIds}
          onApply={setSelectedMemberIds}
          members={scopedDevelopers}
        />
      </Flex>

      {/* Legend + plan overlay toggle */}
      <Flex justify="space-between" align="center" mb={4} wrap="wrap" gap={3}>
        <HStack spacing={4} fontSize="xs" color="neutral.500" wrap="wrap">
          <HStack spacing={1.5}>
            <Box
              w="16px"
              h="10px"
              borderRadius="sm"
              bg="#4f46e5"
              borderLeft="3px solid #ea580c"
            />
            <Text>Task · priority accent</Text>
          </HStack>
          <HStack spacing={1.5}>
            <Box w="16px" h="10px" borderRadius="sm" bg="#4f46e5" position="relative">
              <Box
                position="absolute"
                top="50%"
                right="1px"
                transform="translateY(-50%)"
                w="5px"
                h="5px"
                borderRadius="full"
                bg="white"
              />
            </Box>
            <Text>In progress now</Text>
          </HStack>
          <HStack spacing={1.5}>
            <Box
              w="16px"
              h="10px"
              borderRadius="sm"
              border="1px solid"
              borderColor="neutral.200"
              backgroundImage="repeating-linear-gradient(45deg,#cbd5e1 0,#cbd5e1 2px,transparent 2px,transparent 5px)"
            />
            <Text>On hold / idle</Text>
          </HStack>
          <HStack spacing={1.5}>
            <Box w="2px" h="12px" bg="red.500" />
            <Text>Current time</Text>
          </HStack>
          <HStack spacing={1.5}>
            <Box
              px={1.5}
              py="1px"
              borderRadius="full"
              border="1px solid"
              borderColor="neutral.200"
              bg="white"
            >
              <Text fontSize="9px" fontWeight={600} color="neutral.500">
                queued
              </Text>
            </Box>
            <Text>Parked / not started</Text>
          </HStack>
        </HStack>
        <Tooltip
          label="Show the planned schedule as a faint track behind actual work"
          placement="top"
          maxW="220px"
          textAlign="center"
        >
          <HStack spacing={2}>
            <Text fontSize="xs" color="neutral.500">
              Show plan
            </Text>
            <Switch
              size="sm"
              colorScheme="blue"
              isChecked={showPlan}
              onChange={(e) => setShowPlan(e.target.checked)}
            />
          </HStack>
        </Tooltip>
      </Flex>

      <Box
        position="relative"
        overflowX="auto"
        mt={4}
        borderRadius="xl"
        border="1px solid rgba(255,255,255,0.2)"
      >
        <Box minW="1400px" pr={8}>
          {/* Header (Time Slots) */}
          <Flex
            ml="150px"
            borderBottom="1px solid"
            borderColor="surface.border"
            pb={0}
            position="sticky"
            top={0}
            zIndex={20}
            bg="rgba(255, 255, 255, 0.95)"
            backdropFilter="blur(10px)"
            direction="column"
          >
            {/* Top Row: AM/PM Bars */}
            <Flex width="100%">
              {/* Logic to group AM and PM */}
              {(() => {
                // We know slots range from config.startHour to config.endHour.
                // We need to find breakdown.
                const start = config.startHour;
                const end = config.endHour;
                // Assuming standard day 24h checks.
                // Find 12pm split.

                const amStart = start;
                const amEnd = Math.min(end, 12);
                const pmStart = Math.max(start, 12);
                const pmEnd = end;

                const amSpan = Math.max(0, amEnd - amStart);
                const pmSpan = Math.max(0, pmEnd - pmStart);

                return (
                  <>
                    {amSpan > 0 && (
                      <Box
                        flex={amSpan}
                        bg="neutral.50"
                        borderRight="1px solid"
                        borderColor="surface.border"
                        textAlign="center"
                        py={1.5}
                      >
                        <Text
                          fontSize="xs"
                          fontWeight={700}
                          color="neutral.500"
                          letterSpacing="0.08em"
                        >
                          AM
                        </Text>
                      </Box>
                    )}
                    {pmSpan > 0 && (
                      <Box flex={pmSpan} bg="neutral.50" textAlign="center" py={1.5}>
                        <Text
                          fontSize="xs"
                          fontWeight={700}
                          color="neutral.500"
                          letterSpacing="0.08em"
                        >
                          PM
                        </Text>
                      </Box>
                    )}
                  </>
                );
              })()}
            </Flex>

            {/* Bottom Row: Numbers */}
            <Flex width="100%" position="relative">
              {timeSlots.map((hour) => (
                <Box
                  key={hour}
                  flex={1}
                  textAlign="center"
                  borderLeft="1px solid"
                  borderColor="neutral.100"
                  py={2.5}
                  position="relative"
                  // `data-group` (rather than `role="group"`) keeps the `_groupHover` reveal
                  // below working while the element's actual ARIA role is "button" (it's a
                  // real click/keyboard target, not a grouping container).
                  data-group=""
                  role="button"
                  tabIndex={0}
                  aria-label={`Zoom into ${formatHour(hour)}`}
                  cursor="pointer"
                  _hover={{ bg: "brand.50" }}
                  _focusVisible={{
                    outline: "2px solid",
                    outlineColor: "blue.400",
                    outlineOffset: "-2px",
                  }}
                  onClick={() => setExpandedHour(hour)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpandedHour(hour);
                    }
                  }}
                  title={`Zoom into ${formatHour(hour)}`}
                >
                  <Text
                    fontSize="xs"
                    color="neutral.500"
                    fontWeight={600}
                    _groupHover={{ color: "brand.600" }}
                  >
                    {formatHour(hour)}
                  </Text>

                  {expandedHour === null && (
                    <Box
                      as={FaSearchPlus}
                      position="absolute"
                      top="4px"
                      right="4px"
                      boxSize="11px"
                      color="brand.600"
                      opacity={0}
                      _groupHover={{ opacity: 1 }}
                      transition="opacity 0.15s"
                    />
                  )}
                </Box>
              ))}
              {/* End Hour Label */}
              <Box
                position="absolute"
                right="0"
                top={0}
                height="100%"
                borderLeft="1px solid"
                borderColor="neutral.100"
                zIndex={1}
              >
                <Text
                  position="absolute"
                  top={2.5}
                  right={2}
                  fontSize="xs"
                  color="neutral.500"
                  fontWeight={600}
                  whiteSpace="nowrap"
                >
                  {formatHour(config.endHour)}
                </Text>
              </Box>
            </Flex>

            {/* Zoomed Header Overwrite if active */}
            {expandedHour !== null && (
              <Flex
                width="100%"
                position="absolute"
                top={0}
                left={0}
                bottom={0}
                bg="white"
                zIndex={2}
              >
                <Flex
                  align="center"
                  gap={1}
                  px={3}
                  borderRight="1px solid"
                  borderColor="surface.border"
                  bg="brand.50"
                >
                  <Text fontWeight={700} fontSize="sm" color="brand.700" whiteSpace="nowrap">
                    {formatHour(expandedHour)}
                  </Text>
                  <IconButton
                    aria-label="Close Zoom"
                    icon={<FaTimes />}
                    size="xs"
                    colorScheme="gray"
                    variant="ghost"
                    onClick={() => setExpandedHour(null)}
                  />
                </Flex>
                <Flex flex={1}>
                  {timeSlots.map((min) => (
                    <Box
                      key={min}
                      flex={1}
                      borderLeft="1px solid"
                      borderColor="neutral.100"
                      py={2.5}
                      textAlign="center"
                    >
                      <Text fontSize="xs" color="neutral.500" fontWeight={600}>
                        :{min.toString().padStart(2, "0")}
                      </Text>
                    </Box>
                  ))}
                </Flex>
              </Flex>
            )}
          </Flex>

          {/* Rows */}
          <Box position="relative">
            {/* Live current-time line spanning all rows (offset past the 150px name column) */}
            {showNowLine && (
              <Box
                position="absolute"
                top={0}
                bottom={0}
                left={`calc(150px + (100% - 150px) * ${nowLeftPct / 100})`}
                zIndex={15}
                pointerEvents="none"
              >
                <Box
                  position="absolute"
                  top="-6px"
                  left="-5px"
                  w="12px"
                  h="12px"
                  borderRadius="full"
                  bg="red.500"
                  boxShadow="0 0 0 4px rgba(239,68,68,0.18)"
                />
                <Box w="2px" h="100%" bg="red.500" opacity={0.9} />
              </Box>
            )}
          <VStack align="stretch" spacing={0}>
            {developers.map((dev) => {
              // Per-dev derivation is memoized above (rowDataByDev) so this map stays cheap
              // even on the minute tick for large teams.
              const { dayBlocks, myTasks, parkedTasks, laneTaskIds, hasEarlier, hasLater, ghostBlocks } =
                rowDataByDev[dev.emp_id] || {
                  dayBlocks: [], myTasks: [], parkedTasks: [], laneTaskIds: [],
                  hasEarlier: false, hasLater: false, ghostBlocks: [],
                };
              const singleDev = developers.length === 1;
              const isExpanded = expandedRows.has(dev.emp_id) || singleDev;

              return (
                <Box
                  key={dev.id}
                  w="100%"
                  borderTop="1px solid"
                  borderColor="neutral.100"
                  // Native row virtualization: skip layout/paint of off-screen rows. The
                  // `auto` size is remembered after first render so scroll height stays
                  // stable even for expanded rows. Ignored by browsers without support.
                  sx={{ contentVisibility: "auto", containIntrinsicSize: "auto 64px" }}
                >
                  {/* Header row: chevron + member + collapsed activity ribbon */}
                  <Box
                    w="100%"
                    h="64px"
                    display="flex"
                    alignItems="center"
                    _hover={{ bg: "neutral.50" }}
                    transition="background 0.15s"
                  >
                    <Flex w="150px" pr={2} align="center" gap={1} flexShrink={0}>
                      <IconButton
                        aria-label={
                          isExpanded ? "Collapse tasks" : "Expand tasks"
                        }
                        icon={
                          isExpanded ? <FaChevronDown /> : <FaChevronRight />
                        }
                        size="xs"
                        variant="ghost"
                        isDisabled={singleDev}
                        onClick={() => toggleRow(dev.emp_id)}
                      />
                      <UserHierarchyPopover user={dev}>
                        <Flex
                          align="center"
                          gap={2.5}
                          cursor="pointer"
                          minW={0}
                          flex={1}
                        >
                          <UserAvatar
                            size="sm"
                            name={dev.emp_name}
                            photo={dev.profile_pic}
                          />
                          <Box minW={0}>
                            <Text
                              fontSize="sm"
                              fontWeight={700}
                              color="neutral.900"
                              isTruncated
                              lineHeight="1.2"
                            >
                              {dev.emp_name}
                            </Text>
                            <Text fontSize="xs" color="neutral.500" isTruncated>
                              {dev.emp_designation || "—"}
                            </Text>
                          </Box>
                        </Flex>
                      </UserHierarchyPopover>
                    </Flex>

                    <Box flex={1} position="relative" h="100%">
                      {gridLinesEl}
                      {/* Planned reservation ghost behind the actual ribbon */}
                      {!isExpanded &&
                        ghostBlocks.map((b, i) =>
                          renderGhost(b, `${dev.emp_id}-ghost-${i}`),
                        )}
                      {/* Multi-day carry-over markers */}
                      {hasEarlier && (
                        <Tooltip label="Has work on earlier days" placement="top">
                          <Box
                            position="absolute"
                            left="2px"
                            top="50%"
                            transform="translateY(-50%)"
                            color="neutral.500"
                            zIndex={4}
                          >
                            <Box as={FaAngleDoubleLeft} boxSize="12px" />
                          </Box>
                        </Tooltip>
                      )}
                      {hasLater && (
                        <Tooltip label="Continues on later days" placement="top">
                          <Box
                            position="absolute"
                            right="2px"
                            top="50%"
                            transform="translateY(-50%)"
                            color="neutral.500"
                            zIndex={4}
                          >
                            <Box as={FaAngleDoubleRight} boxSize="12px" />
                          </Box>
                        </Tooltip>
                      )}
                      {/* Collapsed only: one activity ribbon. When expanded, the per-task
                          lanes below carry the segments — don't draw them twice. */}
                      {!isExpanded &&
                        dayBlocks.map((b, i) =>
                          renderSegment(
                            b,
                            dev,
                            `${dev.emp_id}-rib-${b.taskId}-${i}`,
                          ),
                        )}
                      {!isExpanded && parkedTasks.length > 0 && (
                        <HStack
                          position="absolute"
                          right={2}
                          top="50%"
                          transform="translateY(-50%)"
                          spacing={1}
                          zIndex={5}
                        >
                          {parkedTasks.slice(0, 4).map((t) =>
                            taskActionPopover(
                              t,
                              dev,
                              `${dev.emp_id}-chip-${t.id}`,
                              <Box
                                role="button"
                                tabIndex={0}
                                aria-label={`${t.task_name} — ${t.task_status}`}
                                px={2}
                                py={0.5}
                                borderRadius="full"
                                bg="white"
                                border="1px solid"
                                borderColor="neutral.200"
                                boxShadow="0 1px 2px rgba(15,23,42,0.08)"
                                cursor="pointer"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onEditTask(t);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    onEditTask(t);
                                  }
                                }}
                                display="flex"
                                alignItems="center"
                                gap={1}
                                _hover={{ bg: "neutral.50" }}
                                _focusVisible={{
                                  outline: "2px solid",
                                  outlineColor: "blue.400",
                                  outlineOffset: "1px",
                                }}
                              >
                                <Box
                                  w="6px"
                                  h="6px"
                                  borderRadius="full"
                                  bg={statusDotColor(t.task_status)}
                                  flexShrink={0}
                                />
                                <Text
                                  fontSize="xx-small"
                                  fontWeight={600}
                                  color="neutral.600"
                                  noOfLines={1}
                                  maxW="90px"
                                >
                                  {t.task_name}
                                </Text>
                                <SubtaskProgressPill task={t} variant="inline" />
                              </Box>,
                            ),
                          )}
                          {parkedTasks.length > 4 && (
                            <Text
                              fontSize="xx-small"
                              fontWeight={700}
                              color="neutral.500"
                            >
                              +{parkedTasks.length - 4}
                            </Text>
                          )}
                        </HStack>
                      )}
                    </Box>
                  </Box>

                  {/* Expanded: one swimlane per task — actual segments + hold gaps */}
                  <Collapse in={isExpanded} animateOpacity>
                    <Box
                      bg="neutral.50"
                      borderTop="1px dashed"
                      borderColor="neutral.200"
                    >
                      {laneTaskIds.length === 0 &&
                        parkedTasks.length === 0 && (
                          <Box pl="158px" py={2}>
                            <Text fontSize="xs" color="neutral.500">
                              No activity today.
                            </Text>
                          </Box>
                        )}

                      {laneTaskIds.map((tid) => {
                        const laneBlocks = dayBlocks
                          .filter((b) => b.taskId === tid)
                          .sort((a, b) => a.startTime - b.startTime);
                        const task = myTasks.find((t) => t.id === tid);
                        return (
                          <Box
                            key={`lane-${dev.emp_id}-${tid}`}
                            w="100%"
                            h="34px"
                            display="flex"
                            alignItems="center"
                          >
                            <Flex
                              w="150px"
                              pl={8}
                              pr={2}
                              align="center"
                              gap={1.5}
                              minW={0}
                              flexShrink={0}
                            >
                              {task?.task_priority && (
                                <Badge
                                  colorScheme={getPriorityColor(
                                    task.task_priority as string,
                                  )}
                                  variant="subtle"
                                  fontSize="xx-small"
                                  borderRadius="sm"
                                  px={1}
                                >
                                  {task.task_priority}
                                </Badge>
                              )}
                              <Text fontSize="xs" color="neutral.700" isTruncated>
                                {task?.task_name || tid}
                              </Text>
                              {task && <SubtaskProgressPill task={task} variant="inline" />}
                            </Flex>
                            <Box flex={1} position="relative" h="100%">
                              {gridLinesEl}
                              {/* hold / idle gaps between this task's own segments */}
                              {expandedHour === null &&
                                laneBlocks.slice(0, -1).map((b, i) => {
                                  const next = laneBlocks[i + 1];
                                  const gap = next.startTime - b.endTime;
                                  if (gap <= 0.03) return null;
                                  const gl =
                                    (b.endTime - config.startHour) *
                                    (100 / totalVisualHours);
                                  const gw = gap * (100 / totalVisualHours);
                                  if (gl > 100 || gl + gw < 0) return null;
                                  return (
                                    <Box
                                      key={`gap-${tid}-${i}`}
                                      position="absolute"
                                      left={`${Math.max(0, gl)}%`}
                                      width={`${Math.min(
                                        100 - Math.max(0, gl),
                                        gw,
                                      )}%`}
                                      top="30%"
                                      h="40%"
                                      borderRadius="sm"
                                      opacity={0.6}
                                      backgroundImage="repeating-linear-gradient(45deg, #cbd5e1 0, #cbd5e1 2px, transparent 2px, transparent 6px)"
                                    />
                                  );
                                })}
                              {laneBlocks.map((b, i) =>
                                renderSegment(
                                  b,
                                  dev,
                                  `${dev.emp_id}-lane-${tid}-${i}`,
                                ),
                              )}
                            </Box>
                          </Box>
                        );
                      })}

                      {parkedTasks.map((t) => (
                        <Box
                          key={`plane-${dev.emp_id}-${t.id}`}
                          w="100%"
                          h="34px"
                          display="flex"
                          alignItems="center"
                        >
                          <Flex
                            w="150px"
                            pl={8}
                            pr={2}
                            align="center"
                            gap={1.5}
                            minW={0}
                            flexShrink={0}
                          >
                            {t.task_priority && (
                              <Badge
                                colorScheme={getPriorityColor(
                                  t.task_priority as string,
                                )}
                                variant="subtle"
                                fontSize="xx-small"
                                borderRadius="sm"
                                px={1}
                              >
                                {t.task_priority}
                              </Badge>
                            )}
                            <Text fontSize="xs" color="neutral.500" isTruncated>
                              {t.task_name}
                            </Text>
                            <SubtaskProgressPill task={t} variant="inline" />
                          </Flex>
                          <Box flex={1} position="relative" h="100%">
                            {gridLinesEl}
                            <HStack
                              position="absolute"
                              left={2}
                              top="50%"
                              transform="translateY(-50%)"
                              spacing={1}
                              zIndex={5}
                            >
                              {taskActionPopover(
                                t,
                                dev,
                                `plane-chip-${dev.emp_id}-${t.id}`,
                                <Box
                                  role="button"
                                  tabIndex={0}
                                  aria-label={`${t.task_name} — ${t.task_status}`}
                                  px={2}
                                  py={0.5}
                                  borderRadius="full"
                                  bg="white"
                                  border="1px solid"
                                  borderColor="neutral.200"
                                  cursor="pointer"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onEditTask(t);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      onEditTask(t);
                                    }
                                  }}
                                  display="flex"
                                  alignItems="center"
                                  gap={1}
                                  _hover={{ bg: "neutral.50" }}
                                  _focusVisible={{
                                    outline: "2px solid",
                                    outlineColor: "blue.400",
                                    outlineOffset: "1px",
                                  }}
                                >
                                  <Box
                                    w="6px"
                                    h="6px"
                                    borderRadius="full"
                                    bg={statusDotColor(t.task_status)}
                                    flexShrink={0}
                                  />
                                  <Text
                                    fontSize="xx-small"
                                    fontWeight={600}
                                    color="neutral.500"
                                  >
                                    {t.task_status === "on-hold"
                                      ? "On hold"
                                      : t.task_status === "backlog"
                                        ? "Backlog"
                                        : "To do"}
                                  </Text>
                                </Box>,
                              )}
                            </HStack>
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  </Collapse>
                </Box>
              );
            })}
          </VStack>
          </Box>
        </Box>
      </Box>
    </Box>
    <Modal isOpen={!!previewAttachment} onClose={() => setPreviewAttachment(null)} size="xl" isCentered>
      <ModalOverlay />
      <ModalContent bg="transparent" boxShadow="none" onClick={(e) => e.stopPropagation()}>
        <ModalCloseButton color="white" bg="blackAlpha.600" borderRadius="full" />
        <ModalBody p={0}>
          {previewAttachment && (
            <Image
              src={previewAttachment.data}
              alt={previewAttachment.filename || "attachment"}
              maxH="80vh"
              mx="auto"
              borderRadius="md"
            />
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
    </>
  );
};

export default TimelineView;
