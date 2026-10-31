import React, { useMemo, useState } from "react";
import {
  Grid,
  GridItem,
  Box,
  Flex,
  Text,
  Input,
  Select,
  Button,
  IconButton,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  NumberIncrementStepper,
  NumberDecrementStepper,
  HStack,
  VStack,
  Divider,
  Progress,
  Badge,
  useToast,
} from "@chakra-ui/react";
import {
  FaTrash,
  FaCalendarAlt,
  FaTag,
  FaUserCircle,
  FaLink,
  FaExpand,
  FaPlus,
  FaBookmark,
  FaTimes,
} from "Utils/icons";
import { useAppDispatch, useAppSelector } from "app/hooks";
import {
  updateTask,
  deleteTask as deleteTaskAction,
} from "app/slices/scheduler.slice";
import { Task, Priority } from "types";
import { PRIORITY_OPTIONS, PRIORITY_LABEL, getPriorityColor } from "Utils/priority";
import {
  useUpdateTaskMutation,
  useDeleteTaskMutation,
  useAddSubtaskMutation,
  useTaskLinksQuery,
} from "Services/user.api";
import { useTaskDetail } from "Contexts/useTaskDetail";
import AssigneePicker from "Components/Timeline/AssigneePicker";
import EpicPicker from "Components/Timeline/EpicPicker";
import SprintPicker from "Components/Timeline/SprintPicker";
import TagsInput from "Components/Timeline/TagsInput";
import InlineEditableText from "Components/Timeline/InlineEditableText";
import TaskComments from "Components/Timeline/TaskComments";
import TaskLinks from "Components/Timeline/TaskLinks";
import TaskGraphView from "Components/Timeline/TaskGraphView";
import TaskAttachments from "Components/Timeline/TaskAttachments";
import SubtaskCreationModal, {
  SubtaskDraft,
} from "Components/Timeline/SubtaskCreationModal";
import { getApiErrorMessage, ApiError } from "Services/baseQuery";
import {
  LABEL_PROPS as SECTION_LABEL_PROPS,
  cardFieldProps,
  sidebarPanelProps,
} from "Components/Timeline/taskModalStyles";

const dueDateToIso = (yyyyMmDd: string): string | undefined =>
  yyyyMmDd ? new Date(`${yyyyMmDd}T23:59:59`).toISOString() : undefined;

const dayLabel = (iso?: string): string => {
  if (!iso) return "";
  const then = new Date(iso);
  const now = new Date();
  const days = Math.floor(
    (new Date(now.toDateString()).getTime() -
      new Date(then.toDateString()).getTime()) /
      86400000,
  );
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
};

const clockLabel = (iso?: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay ? `today at ${time}` : `${d.toLocaleDateString()} at ${time}`;
};

interface TaskDetailFormProps {
  task: Task;
  /** Present in modal mode (renders the Close button); absent in the full-page view. */
  onClose?: () => void;
  /** Present in modal mode only — navigates to the full-page view and closes the modal. */
  onMaximize?: () => void;
}

/**
 * Shared task view/edit surface — the actual fields, rendered identically whether hosted
 * inside `TaskDetailModal` or the full-page `TaskDetailPage` (so "maximize" is a pure chrome
 * swap, not a different form). Structured fields (status/assignee/priority/due date) save
 * immediately on change; title/description are Jira-style double-click-to-edit text so a
 * stray click can't overwrite them, per the "view first, edit deliberately" request.
 */
const TaskDetailForm: React.FC<TaskDetailFormProps> = ({
  task,
  onClose,
  onMaximize,
}) => {
  const dispatch = useAppDispatch();
  const toast = useToast();
  const { openTaskDetail } = useTaskDetail();
  const { tasks, developers } = useAppSelector(
    (state) => state.scheduler,
  );
  const [updateTaskApi] = useUpdateTaskMutation();
  const [deleteTaskApi] = useDeleteTaskMutation();
  const [addSubtaskApi] = useAddSubtaskMutation();
  const [subtaskModalOpen, setSubtaskModalOpen] = useState(false);
  const { data: links = [] } = useTaskLinksQuery(task.id, { skip: !task.id });
  // This task's own subtasks (children) and, if it IS a subtask, its parent story — both
  // navigable so you can move up/down the story <-> subtask relationship from either side.
  const childSubtasks = links.filter(
    (l) => l.link_type === "subtask" && l.direction === "incoming",
  );
  const parentLink = links.find(
    (l) => l.link_type === "subtask" && l.direction === "outgoing",
  );
  const openLinkedTask = (linkedTaskId: string) => {
    const full = tasks.find((t) => t.id === linkedTaskId);
    if (full) openTaskDetail(full);
  };

  // Read the live Redux copy so an earlier field save in this session is reflected — the
  // `task` prop only identifies WHICH task, and is a fallback before the first refetch.
  const activeTask = useMemo(
    () => tasks.find((t) => t.id === task.id) || task,
    [tasks, task],
  );

  const durationParts = useMemo(() => {
    const raw = activeTask.task_duration || "1";
    if (String(raw).includes(":")) {
      const [h, m] = String(raw).split(":").map(Number);
      return { h: h || 0, m: m || 0 };
    }
    const totalMinutes = Math.round(Number(raw) * 60);
    return { h: Math.floor(totalMinutes / 60), m: totalMinutes % 60 };
  }, [activeTask.task_duration]);

  // Returns whether the save actually succeeded — callers that show their own success toast
  // (Pick/Hold/Done below) need this, since a 409 (e.g. "Finish these first: <subtasks>" from
  // completion_blockers) must not be followed by a false "Task Completed" toast.
  const saveField = async (patch: Partial<Task>): Promise<boolean> => {
    const previous = activeTask;
    const updated: Task = { ...activeTask, ...patch };
    dispatch(updateTask(updated));
    try {
      const resp = await updateTaskApi(updated).unwrap();
      if (resp) dispatch(updateTask(resp));
      return true;
    } catch (e) {
      // Revert the optimistic update — the server rejected it (e.g. completion blocked by
      // unfinished subtasks), so the UI shouldn't keep showing the change as if it landed.
      dispatch(updateTask(previous));
      toast({
        title: "Failed to save change",
        description: getApiErrorMessage(e),
        status: "error",
      });
      return false;
    }
  };

  const handleAddSubtask = async (draft: SubtaskDraft) => {
    // Unlike the create-modal's staged batch (parent doesn't exist yet, so nothing can be
    // created until the whole thing submits together), this task already exists — the subtask
    // is created and linked immediately, with its own real id/ticket_id.
    try {
      await addSubtaskApi({
        taskId: activeTask.id,
        task_name: draft.task_name,
        task_assigned_to: draft.assigneeId,
        task_description: draft.task_description,
        task_status: draft.task_status,
        task_priority: draft.task_priority,
        task_tags: draft.task_tags,
        task_duration: draft.task_duration,
        task_due_date: draft.task_due_date,
        attachments: draft.attachments?.map((f) => ({
          filename: f.filename,
          content_type: f.content_type,
          data: f.data,
        })),
      }).unwrap();
      toast({ title: "Subtask added", status: "success" });
    } catch (e) {
      toast({
        title: "Failed to add subtask",
        description: getApiErrorMessage(e),
        status: "error",
      });
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete task "${activeTask.task_name}"?`)) return;
    try {
      await deleteTaskApi(activeTask.id).unwrap();
      dispatch(deleteTaskAction(activeTask.id));
      toast({ title: "Task deleted", status: "success" });
      onClose?.();
    } catch (e) {
      const message = getApiErrorMessage(e);
      // 409 = has subtasks (completion_blockers-style guard on delete_task). Offer the
      // cascade retry right here instead of just reporting the block and leaving it a dead end.
      if (Number((e as ApiError)?.status) === 409) {
        const wantsCascade = window.confirm(
          `${message}\n\nDelete this task AND its subtask(s) too?`,
        );
        if (wantsCascade) {
          try {
            await deleteTaskApi({ taskId: activeTask.id, cascade: true }).unwrap();
            dispatch(deleteTaskAction(activeTask.id));
            toast({ title: "Task and its subtasks deleted", status: "success" });
            onClose?.();
          } catch (e2) {
            toast({
              title: "Failed to delete task",
              description: getApiErrorMessage(e2),
              status: "error",
            });
          }
        }
        return;
      }
      toast({ title: "Failed to delete task", description: message, status: "error" });
    }
  };

  const handleCopyLink = async () => {
    const url = `${window.location.origin}/tasks/${activeTask.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", status: "success", duration: 2000 });
    } catch {
      toast({ title: "Could not copy link", status: "error" });
    }
  };

  const handleSaveChanges = () => {
    // Flush any in-progress inline edit (title/description/tag draft) by blurring it, which
    // triggers that field's own commit-on-blur — everything else already autosaves on change.
    (document.activeElement as HTMLElement | null)?.blur();
    toast({ title: "All changes saved", status: "success", duration: 1500 });
  };

  const STATUS_OPTIONS = [
    { value: "backlog", label: "Backlog" },
    { value: "todo", label: "To Do" },
    { value: "in-progress", label: "In Progress" },
    { value: "on-hold", label: "On Hold" },
    { value: "done", label: "Done" },
  ];

  // Same Pick/Hold/Done actions as the timeline's hover popover (`handlePickFromTimeline` /
  // `handleHoldTask` / `handleCompleteTask` in TimelineView.tsx) — kept in sync manually since
  // there's no shared hook yet; both paths ultimately just PUT the new task_status.
  const handleQuickPick = async () => {
    const active = tasks.find(
      (t) =>
        t.task_assigned_to === activeTask.task_assigned_to &&
        t.id !== activeTask.id &&
        ["in-progress", "in progress"].includes(
          (t.task_status || "").toLowerCase(),
        ),
    );
    if (active) dispatch(updateTask({ ...active, task_status: "on-hold" }));
    const ok = await saveField({ task_status: "in-progress" });
    if (ok) {
      toast({
        title: "Task Picked",
        description: `${activeTask.task_name} is now in progress.`,
        status: "success",
        duration: 3000,
      });
    }
  };

  const handleQuickHold = async () => {
    const ok = await saveField({ task_status: "on-hold" });
    if (ok) {
      toast({ title: "Task On Hold", description: "Task paused and moved to pending list.", status: "warning", duration: 3000 });
    }
  };

  const handleQuickDone = async () => {
    const isPriorityOrActive =
      activeTask.task_priority === "P0" || activeTask.task_status === "in-progress";
    if (activeTask.task_assigned_to && !isPriorityOrActive) {
      const pending = tasks
        .filter(
          (t) =>
            t.task_assigned_to === activeTask.task_assigned_to &&
            !["done", "completed", "backlog"].includes((t.task_status || "").toLowerCase()),
        )
        .sort(
          (a, b) =>
            new Date(a.task_assigned_date || a.task_created_at || 0).getTime() -
            new Date(b.task_assigned_date || b.task_created_at || 0).getTime(),
        );
      const first = pending[0];
      if (first && first.id !== activeTask.id) {
        toast({
          title: "Cannot Complete Task",
          description: `Please complete '${first.task_name}' first, or increase this task's priority.`,
          status: "warning",
          duration: 4000,
        });
        return;
      }
    }
    const ok = await saveField({ task_status: "done" });
    if (ok) {
      toast({ title: "Task Completed", description: `${activeTask.task_name} marked as done.`, status: "success", duration: 3000 });
    }
  };

  const statusLower = (activeTask.task_status || "").toLowerCase();

  const assignedBy = developers.find(
    (d) => d.emp_id === activeTask.task_assigned_by,
  );
  const dueDateValue = activeTask.task_due_date
    ? new Date(activeTask.task_due_date).toISOString().slice(0, 10)
    : "";
  const shortId = `#${activeTask.id.slice(-6).toUpperCase()}`;
  const primaryTag = (activeTask.task_tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)[0];

  return (
    <>
    <Box display="flex" flexDirection="column" h="100%" minH={0}>
      {/* Header — never scrolls */}
      <Box
        borderBottom="1px solid"
        borderColor="surface.border"
        px={{ base: 4, md: 8 }}
        py={4}
        flexShrink={0}
      >
        <Flex justify="space-between" align="start" gap={3}>
          <Box flex={1} minW={0}>
            <HStack spacing={1.5} fontSize="xs" color="neutral.500" mb={1}>
              <Text>{shortId}</Text>
              {primaryTag && (
                <>
                  <Text>›</Text>
                  <Text>{primaryTag}</Text>
                </>
              )}
            </HStack>
            {parentLink && (
              <Box
                as="button"
                type="button"
                onClick={() => openLinkedTask(parentLink.task_id)}
                display="flex"
                alignItems="center"
                gap={1}
                mb={1}
                color="brand.600"
                fontSize="xs"
                fontWeight={600}
                _hover={{ textDecoration: "underline" }}
              >
                <Box as={FaBookmark} boxSize="10px" fill="currentColor" />
                Subtask of {parentLink.task_ticket_id || `#${parentLink.task_id.slice(-6).toUpperCase()}`}
                {" "}
                {parentLink.task_name}
              </Box>
            )}
            <InlineEditableText
              value={activeTask.task_name}
              onCommit={(v) => v && saveField({ task_name: v })}
              displayProps={{
                fontSize: "xl",
                fontWeight: 700,
                color: "neutral.900",
              }}
              inputProps={{ fontSize: "xl", fontWeight: 700 }}
              emptyLabel="Untitled task"
            />
          </Box>
          <HStack spacing={1} flexShrink={0}>
            {onMaximize && (
              <IconButton
                aria-label="Open full page"
                icon={<FaExpand />}
                variant="ghost"
                size="sm"
                onClick={onMaximize}
              />
            )}
            <IconButton
              aria-label="Copy link"
              icon={<FaLink />}
              variant="ghost"
              size="sm"
              onClick={handleCopyLink}
            />
            <IconButton
              aria-label="Delete task"
              icon={<FaTrash />}
              variant="ghost"
              size="sm"
              colorScheme="red"
              onClick={handleDelete}
            />
            {/* Deliberately last and visually set apart (divider + extra gap) — the top-right
                corner is where users reflexively click to close, and having the destructive
                Delete icon sit there (its old position) was getting mistaken for "close".
                Close is the only control that actually belongs in that spot. */}
            {onClose && (
              <>
                <Box w="1px" h="20px" bg="surface.border" mx={1} />
                <IconButton
                  aria-label="Close"
                  icon={<FaTimes />}
                  variant="ghost"
                  size="sm"
                  borderRadius="full"
                  onClick={onClose}
                />
              </>
            )}
          </HStack>
        </Flex>
      </Box>

      {/* Body — ONE shared scroll region for both columns, same as the create-task modal
          (no independent per-column scrolling). */}
      <Box flex={1} minH={0} overflowY="auto" px={{ base: 4, md: 8 }} py={6}>
        <Grid templateColumns={{ base: "1fr", md: "3fr 1.2fr" }} gap={8}>
          <GridItem>
            <VStack align="stretch" spacing={6}>
              <Box>
                <Text {...SECTION_LABEL_PROPS} mb={2}>
                  Description
                </Text>
                <Box
                  // bg={PANEL_BG}
                  border="1px solid"
                  borderColor="surface.border"
                  borderRadius="0.75rem"
                  p={4}
                >
                  <InlineEditableText
                    as="textarea"
                    value={activeTask.task_description || ""}
                    onCommit={(v) => saveField({ task_description: v })}
                    textareaProps={{ rows: 5, bg: "white" }}
                    emptyLabel="Double-click to add a description..."
                  />
                </Box>
              </Box>

              {/* A subtask can never have subtasks of its own (depth is capped at 2 levels —
                  story -> subtask, see check_subtask_depth server-side); this whole section
                  would always be empty on a subtask's own page, so it's hidden entirely rather
                  than shown with a dead-end "Add Subtask" button that can only 409. */}
              {!parentLink && (
              <Box>
                <Flex align="center" justify="space-between" mb={2}>
                  <Text {...SECTION_LABEL_PROPS}>
                    Subtasks
                    {!!activeTask.subtask_total && ` (${activeTask.subtask_done || 0}/${activeTask.subtask_total})`}
                  </Text>
                  <Box
                    as="button"
                    type="button"
                    onClick={() => setSubtaskModalOpen(true)}
                    color="brand.600"
                    fontSize="xs"
                    fontWeight={600}
                    display="flex"
                    alignItems="center"
                    gap={1}
                    _hover={{ textDecoration: "underline" }}
                  >
                    <Box as={FaPlus} boxSize="11px" /> Add Subtask
                  </Box>
                </Flex>
                {!!activeTask.subtask_total && (
                  <Progress
                    value={((activeTask.subtask_done || 0) / activeTask.subtask_total) * 100}
                    size="sm"
                    borderRadius="full"
                    colorScheme="brand"
                    bg="neutral.100"
                    mb={3}
                  />
                )}
                {childSubtasks.length === 0 ? (
                  <Text fontSize="sm" color="neutral.500">
                    No subtasks yet.
                  </Text>
                ) : (
                  <VStack align="stretch" spacing={2}>
                    {childSubtasks.map((l) => {
                      const dev = developers.find((d) => d.emp_id === l.task_assigned_to);
                      const isDone = ["done", "completed"].includes(
                        (l.task_status || "").toLowerCase(),
                      );
                      return (
                        <Flex
                          key={l.link_id}
                          as="button"
                          type="button"
                          onClick={() => openLinkedTask(l.task_id)}
                          align="center"
                          justify="space-between"
                          gap={3}
                          p={3}
                          bg="white"
                          border="1px solid"
                          borderColor="surface.border"
                          borderRadius="0.75rem"
                          textAlign="left"
                          _hover={{ borderColor: "brand.300", boxShadow: "sm" }}
                        >
                          <Flex align="center" gap={2} minW={0} flex={1}>
                            <Box
                              as={FaBookmark}
                              color="brand.600"
                              boxSize="11px"
                              flexShrink={0}
                              fill="currentColor"
                            />
                            <Text fontSize="xs" color="neutral.500" flexShrink={0}>
                              {l.task_ticket_id || `#${l.task_id.slice(-6).toUpperCase()}`}
                            </Text>
                            <Text
                              fontSize="sm"
                              fontWeight={600}
                              color="neutral.900"
                              textDecoration={isDone ? "line-through" : undefined}
                              isTruncated
                            >
                              {l.task_name}
                            </Text>
                          </Flex>
                          <Flex align="center" gap={2} flexShrink={0}>
                            {l.task_priority && (
                              <Badge colorScheme={getPriorityColor(l.task_priority)} fontSize="0.6rem">
                                {l.task_priority}
                              </Badge>
                            )}
                            <Text fontSize="xs" fontWeight={600} color="neutral.700" isTruncated maxW="110px">
                              {dev?.emp_name || l.task_assigned_to || "Unassigned"}
                            </Text>
                          </Flex>
                        </Flex>
                      );
                    })}
                  </VStack>
                )}
              </Box>
              )}

              <Box>
                <TaskAttachments taskId={activeTask.id} />
              </Box>

              <Divider />
              <TaskComments taskId={activeTask.id} />
            </VStack>
          </GridItem>

          {/* Right sidebar — a floating card, same treatment as the create-task modal's
              sidebar, not a full-height bordered column. */}
          <GridItem>
            <Box {...sidebarPanelProps} p={6}>
              <VStack align="stretch" spacing={5}>
                <Box>
                  <Flex align="center" gap={1.5} mb={2}>
                    <Box as={FaUserCircle} color="neutral.500" boxSize="12px" />
                    <Text {...SECTION_LABEL_PROPS}>Assignee</Text>
                  </Flex>
                  <AssigneePicker
                    value={activeTask.task_assigned_to}
                    onChange={(empId) => saveField({ task_assigned_to: empId })}
                    developers={developers}
                  />
                </Box>

                <Grid templateColumns="1fr 1fr" gap={3}>
                  <Box>
                    <Text {...SECTION_LABEL_PROPS} mb={2}>
                      Priority
                    </Text>
                    <Select
                      value={activeTask.task_priority}
                      onChange={(e) =>
                        saveField({ task_priority: e.target.value })
                      }
                      {...cardFieldProps}
                    >
                      {PRIORITY_OPTIONS.map((p) => (
                        <option key={p} value={p} title={PRIORITY_LABEL[p]}>
                          {p}
                        </option>
                      ))}
                    </Select>
                  </Box>
                  <Box>
                    <Text {...SECTION_LABEL_PROPS} mb={2}>
                      Status
                    </Text>
                    <Select
                      value={activeTask.task_status}
                      onChange={(e) =>
                        saveField({ task_status: e.target.value })
                      }
                      {...cardFieldProps}
                    >
                      {STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  </Box>
                </Grid>

                {/* Only a top-level story can roll up into an Epic — a subtask never carries
                    its own epic_id (see the Subtasks section above, hidden by this same
                    `!parentLink` check). */}
                {!parentLink && (
                  <Box>
                    <Text {...SECTION_LABEL_PROPS} mb={2}>
                      Epic
                    </Text>
                    <EpicPicker
                      value={activeTask.epic_id}
                      onChange={(epicId) => saveField({ epic_id: epicId })}
                    />
                  </Box>
                )}

                {/* Unlike Epic, Sprint isn't gated to top-level stories — a sprint is a slice
                    of TIME, independent of the story/subtask scope hierarchy, so any task
                    (including a subtask) may be scoped to one. */}
                <Box>
                  <Text {...SECTION_LABEL_PROPS} mb={2}>
                    Sprint
                  </Text>
                  <SprintPicker
                    value={activeTask.sprint_id}
                    onChange={(sprintId) => saveField({ sprint_id: sprintId })}
                  />
                </Box>

                {statusLower !== "done" && (
                  <HStack spacing={2}>
                    {statusLower !== "in-progress" && (
                      <Button size="sm" colorScheme="brand" flex={1} onClick={handleQuickPick}>
                        {statusLower === "on-hold" ? "Resume" : "Pick"}
                      </Button>
                    )}
                    {statusLower === "in-progress" && (
                      <Button size="sm" variant="outline" colorScheme="yellow" flex={1} onClick={handleQuickHold}>
                        Hold
                      </Button>
                    )}
                    <Button size="sm" variant="outline" colorScheme="green" flex={1} onClick={handleQuickDone}>
                      Done
                    </Button>
                  </HStack>
                )}

                <Box>
                  <Flex align="center" gap={1.5} mb={2}>
                    <Box
                      as={FaCalendarAlt}
                      color="neutral.500"
                      boxSize="12px"
                    />
                    <Text {...SECTION_LABEL_PROPS}>Due Date</Text>
                  </Flex>
                  <Input
                    type="date"
                    value={dueDateValue}
                    onChange={(e) =>
                      saveField({ task_due_date: dueDateToIso(e.target.value) })
                    }
                    px={4}
                    {...cardFieldProps}
                  />
                </Box>

                <Box>
                  <HStack spacing={3}>
                    <Box>
                      <Text {...SECTION_LABEL_PROPS} mb={1}>
                        Hours
                      </Text>
                      <NumberInput
                        min={0}
                        max={100}
                        value={durationParts.h}
                        onChange={(_, val) => {
                          const h = Number.isNaN(val) ? 0 : val;
                          saveField({
                            task_duration: `${String(h).padStart(2, "0")}:${String(durationParts.m).padStart(2, "0")}`,
                          });
                        }}
                        w="90px"
                      >
                        <NumberInputField {...cardFieldProps} px={3} />
                        <NumberInputStepper>
                          <NumberIncrementStepper />
                          <NumberDecrementStepper />
                        </NumberInputStepper>
                      </NumberInput>
                    </Box>
                    <Box>
                      <Text {...SECTION_LABEL_PROPS} mb={1}>
                        Minutes
                      </Text>
                      <NumberInput
                        min={0}
                        max={59}
                        value={durationParts.m}
                        onChange={(_, val) => {
                          const m = Number.isNaN(val) ? 0 : val;
                          saveField({
                            task_duration: `${String(durationParts.h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
                          });
                        }}
                        w="90px"
                      >
                        <NumberInputField {...cardFieldProps} px={3} />
                        <NumberInputStepper>
                          <NumberIncrementStepper />
                          <NumberDecrementStepper />
                        </NumberInputStepper>
                      </NumberInput>
                    </Box>
                  </HStack>
                </Box>

                <Box>
                  <Flex align="center" gap={1.5} mb={2}>
                    <Box as={FaTag} color="neutral.500" boxSize="12px" />
                    <Text {...SECTION_LABEL_PROPS}>Tags</Text>
                  </Flex>
                  <TagsInput
                    value={activeTask.task_tags}
                    onChange={(v) => saveField({ task_tags: v || undefined })}
                  />
                </Box>

                <Box
                  pt={4}
                  borderTop="1px solid"
                  borderColor="rgba(229,231,235,0.6)"
                >
                  <Flex align="center" justify="space-between" mb={3}>
                    <Text {...SECTION_LABEL_PROPS} mb={0}>
                      Links &amp; Dependencies
                    </Text>
                    <TaskGraphView taskId={activeTask.id} />
                  </Flex>
                  <TaskLinks taskId={activeTask.id} />
                </Box>
              </VStack>
            </Box>
          </GridItem>
        </Grid>
      </Box>

      {/* Footer — outermost, never scrolls, same treatment as the create-task modal's footer.
          Meta on the left (there's room), actions on the right. */}
      <Flex
        justify="space-between"
        align="center"
        wrap="wrap"
        gap={3}
        px={{ base: 4, md: 8 }}
        py={4}
        borderTop="1px solid"
        borderColor="surface.border"
        flexShrink={0}
      >
        <Box fontSize="xs" color="neutral.500">
          <Text>
            Reported by{" "}
            {assignedBy?.emp_name || activeTask.task_assigned_by || "—"}
            {activeTask.task_created_at
              ? ` • Created ${dayLabel(activeTask.task_created_at)}`
              : ""}
          </Text>
          {activeTask.task_updated_at && (
            <Text fontSize="xs" color="neutral.500">
              Last updated {clockLabel(activeTask.task_updated_at)}
            </Text>
          )}
        </Box>
        <HStack spacing={3}>
          {onClose && (
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          )}
          <Button colorScheme="brand" onClick={handleSaveChanges}>
            Save Changes
          </Button>
        </HStack>
      </Flex>
    </Box>
    <SubtaskCreationModal
      isOpen={subtaskModalOpen}
      onClose={() => setSubtaskModalOpen(false)}
      onAdd={handleAddSubtask}
      defaultPriority={activeTask.task_priority as Priority}
    />
    </>
  );
};

export default TaskDetailForm;
