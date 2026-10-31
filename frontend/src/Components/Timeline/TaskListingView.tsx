import React from "react";
import {
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Badge,
  Box,
  Text,
  IconButton,
  Tooltip,
  useToast,
  Input,
  Select,
  Checkbox,
  Flex,
  InputGroup,
  InputLeftElement,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverArrow,
  PopoverBody,
  Portal,
  VStack,
} from "@chakra-ui/react";
import {
  FaTrash,
  FaEdit,
  FaSearch,
  FaBookmark,
  FaBookmarkPlus,
} from "Utils/icons";
import {
  useDeleteTaskMutation,
  useUpdateTaskMutation,
} from "Services/user.api";
import { HStack, Button as ChakraButton } from "@chakra-ui/react";
import { useAppSelector, useAppDispatch } from "app/hooks";
import {
  updateTask as updateTaskAction,
  deleteTask as deleteTaskAction,
} from "app/slices/scheduler.slice";
import { Task } from "types";
import { ADMIN_ROLES, SUPER_ADMIN_ROLES } from "Utils/constants";
import AssigneePicker from "Components/Timeline/AssigneePicker";
import { formatDuration } from "Utils/common";
import { getPriorityColor, PRIORITY_OPTIONS } from "Utils/priority";
import { useSavedViews } from "hooks/useSavedViews";
import { getApiErrorMessage, ApiError } from "Services/baseQuery";

// Pinned-column widths — the Task Name column's `left` offset must equal CHECKBOX_COL_W
// exactly for the sticky columns to line up while the rest of the table scrolls under them.
const CHECKBOX_COL_W = "40px";
const TASK_COL_W = "140px";

const STATUS_META: Record<string, { color: string; label: string }> = {
  "in-progress": { color: "blue.500", label: "In Progress" },
  todo: { color: "neutral.400", label: "To Do" },
  backlog: { color: "orange.400", label: "Backlog" },
  "on-hold": { color: "yellow.400", label: "On Hold" },
  done: { color: "green.500", label: "Done" },
  completed: { color: "green.500", label: "Done" },
};
const statusMeta = (s?: string) =>
  STATUS_META[(s || "").toLowerCase()] || {
    color: "neutral.300",
    label: s || "—",
  };

interface TaskListingViewProps {
  onEditTask: (task: Task) => void;
  filteredManagerId?: string;
}

const TaskListingView: React.FC<TaskListingViewProps> = ({ onEditTask }) => {
  const {
    tasks: allTasks,
    developers,
    currentUser,
  } = useAppSelector((state) => state.scheduler);

  const [deleteTaskApi] = useDeleteTaskMutation();
  const [updateTaskApi] = useUpdateTaskMutation();
  const dispatch = useAppDispatch();
  const toast = useToast();

  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [priorityFilter, setPriorityFilter] = React.useState("all");
  // Department is a first-class cross-cutting filter alongside status/priority (not just
  // org-tree scoping) — see scale-gaps-plan.md §B.2. Client-side, same as status/priority:
  // `developers` (the org directory) is already in Redux, so no extra fetch is needed.
  const [departmentFilter, setDepartmentFilter] = React.useState("all");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const departments = React.useMemo(() => {
    const set = new Set(
      developers.map((d) => d.emp_department).filter((d): d is string => !!d),
    );
    return Array.from(set).sort();
  }, [developers]);

  // Saved views: named presets of the search/status/priority filters, persisted to
  // localStorage per user (frontend-only — no backend/migration needed).
  const {
    views: savedViews,
    saveView,
    deleteView,
  } = useSavedViews(currentUser?.emp_id);
  const [newViewName, setNewViewName] = React.useState("");
  const applyView = (v: {
    search: string;
    statusFilter: string;
    priorityFilter: string;
  }) => {
    setSearch(v.search);
    setStatusFilter(v.statusFilter);
    setPriorityFilter(v.priorityFilter);
  };
  const handleSaveView = () => {
    saveView(newViewName, { search, statusFilter, priorityFilter });
    setNewViewName("");
  };
  const hasActiveFilters =
    !!search || statusFilter !== "all" || priorityFilter !== "all" || departmentFilter !== "all";

  // Inline assignee change from the table row: optimistic update, revert + toast on failure —
  // same pattern as TaskDetailForm's saveField.
  const handleAssigneeChange = async (task: Task, empId: string) => {
    const updated = { ...task, task_assigned_to: empId };
    dispatch(updateTaskAction(updated));
    try {
      await updateTaskApi(updated).unwrap();
      toast({ title: "Assignee updated", status: "success" });
    } catch {
      dispatch(updateTaskAction(task));
      toast({ title: "Failed to update assignee", status: "error" });
    }
  };

  const handleDelete = async (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this task?")) return;
    try {
      await deleteTaskApi(taskId).unwrap();
      dispatch(deleteTaskAction(taskId));
      toast({ title: "Task deleted", status: "success" });
    } catch (err) {
      const message = getApiErrorMessage(err);
      // 409 = it has subtasks (delete_task's own guard). Offer the cascade retry here too,
      // same as the task-detail view, instead of leaving the block as a dead end.
      if (Number((err as ApiError)?.status) === 409) {
        if (window.confirm(`${message}\n\nDelete this task AND its subtask(s) too?`)) {
          try {
            await deleteTaskApi({ taskId, cascade: true }).unwrap();
            dispatch(deleteTaskAction(taskId));
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

  const [page, setPage] = React.useState(1);
  const pageSize = 10;

  const isRegularUser =
    currentUser &&
    !ADMIN_ROLES.includes(currentUser.emp_designation) &&
    !SUPER_ADMIN_ROLES.includes(currentUser.emp_designation);

  // Single source of truth: the tasks already fetched into Redux by the page (the same
  // data the timeline renders). A regular user only ever sees their own tasks; admin/manager
  // scoping is applied server-side upstream.
  const scopedTasks = React.useMemo(() => {
    if (isRegularUser && currentUser) {
      return allTasks.filter((t) => t.task_assigned_to === currentUser.emp_id);
    }
    return allTasks;
  }, [allTasks, isRegularUser, currentUser]);

  // Search (name / tags / assignee) + status + priority filters.
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return scopedTasks.filter((t) => {
      if (
        statusFilter !== "all" &&
        (t.task_status || "").toLowerCase() !== statusFilter
      ) {
        return false;
      }
      if (priorityFilter !== "all" && t.task_priority !== priorityFilter) {
        return false;
      }
      const assignee = developers.find((d) => d.emp_id === t.task_assigned_to);
      if (departmentFilter !== "all" && (assignee?.emp_department || "") !== departmentFilter) {
        return false;
      }
      if (!q) return true;
      const hay = `${t.task_name || ""} ${t.task_tags || ""} ${
        assignee?.emp_name || ""
      }`.toLowerCase();
      return hay.includes(q);
    });
  }, [scopedTasks, search, statusFilter, priorityFilter, departmentFilter, developers]);

  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  // Reset to page 1 whenever the result set changes, so we never land out of range.
  React.useEffect(() => {
    setPage(1);
  }, [totalItems, currentUser, search, statusFilter, priorityFilter, departmentFilter]);

  const tasks = React.useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page],
  );

  const isFetching = false;
  const handleNext = () => setPage((p) => Math.min(p + 1, totalPages));
  const handlePrev = () => setPage((p) => Math.max(p - 1, 1));

  // ── selection + bulk operations ─────────────────────────────────────────
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) {
        n.delete(id);
      } else {
        n.add(id);
      }
      return n;
    });
  const pageIds = tasks.map((t) => t.id);
  const allOnPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleAllOnPage = () =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (allOnPageSelected) pageIds.forEach((id) => n.delete(id));
      else pageIds.forEach((id) => n.add(id));
      return n;
    });
  const clearSelection = () => setSelected(new Set());

  const bulkDelete = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} task(s)? This cannot be undone.`))
      return;
    // allSettled (not all): one task blocked on unfinished subtasks (409) shouldn't sink the
    // whole batch — the rest that succeeded should still land, and the toast should say which
    // ones didn't (and why) instead of a blanket "Bulk delete failed".
    const results = await Promise.allSettled(ids.map((id) => deleteTaskApi(id).unwrap()));
    const failed: { id: string; message?: string }[] = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        dispatch(deleteTaskAction(ids[i]));
      } else {
        const name = scopedTasks.find((t) => t.id === ids[i])?.task_name || ids[i];
        failed.push({ id: name, message: getApiErrorMessage(r.reason) });
      }
    });
    const succeededCount = ids.length - failed.length;
    if (succeededCount > 0) {
      toast({ title: `${succeededCount} task(s) deleted`, status: "success" });
    }
    if (failed.length > 0) {
      toast({
        title: `${failed.length} task(s) couldn't be deleted`,
        description: failed.map((f) => `${f.id}: ${f.message}`).join("; "),
        status: "error",
        duration: 8000,
      });
    }
    clearSelection();
  };

  const bulkSetStatus = async (status: string) => {
    if (!status) return;
    const ids = [...selected];
    const targets = scopedTasks.filter((t) => ids.includes(t.id));
    try {
      await Promise.all(
        targets.map((t) => {
          const updated = { ...t, task_status: status };
          dispatch(updateTaskAction(updated));
          return updateTaskApi(updated).unwrap();
        }),
      );
      toast({ title: `Updated ${targets.length} task(s)`, status: "success" });
      clearSelection();
    } catch {
      toast({ title: "Bulk update failed", status: "error" });
    }
  };

  return (
    <Box
      bg="surface.card"
      border="1px solid"
      borderColor="surface.border"
      borderRadius="card"
      boxShadow="card"
    >
      {/* Toolbar: search + status/priority filters + bulk actions */}
      <Flex
        px={5}
        py={3}
        gap={3}
        align="center"
        wrap="wrap"
        borderBottom="1px solid"
        borderColor="surface.border"
      >
        <InputGroup maxW="260px" size="sm">
          <InputLeftElement pointerEvents="none">
            <Box as={FaSearch} color="neutral.500" boxSize="12px" />
          </InputLeftElement>
          <Input
            placeholder="Search tasks, tags, assignee"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </InputGroup>
        <Select
          size="sm"
          maxW="150px"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="todo">To Do</option>
          <option value="in-progress">In Progress</option>
          <option value="on-hold">On Hold</option>
          <option value="backlog">Backlog</option>
          <option value="done">Done</option>
        </Select>
        <Select
          size="sm"
          maxW="140px"
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
        >
          <option value="all">All priorities</option>
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        {departments.length > 0 && (
          <Select
            size="sm"
            maxW="160px"
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
          >
            <option value="all">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        )}

        <Popover placement="bottom-start" isLazy>
          <PopoverTrigger>
            <ChakraButton
              size="sm"
              variant="outline"
              leftIcon={<FaBookmark />}
              borderRadius="md"
            >
              Views{savedViews.length > 0 ? ` (${savedViews.length})` : ""}
            </ChakraButton>
          </PopoverTrigger>
          <Portal>
            <PopoverContent w="280px" boxShadow="xl" borderRadius="lg">
              <PopoverArrow />
              <PopoverBody>
                <Text
                  fontSize="xs"
                  fontWeight={700}
                  color="neutral.500"
                  textTransform="uppercase"
                  mb={2}
                >
                  Saved views
                </Text>
                {savedViews.length === 0 ? (
                  <Text fontSize="sm" color="neutral.500" mb={3}>
                    No saved views yet.
                  </Text>
                ) : (
                  <VStack
                    align="stretch"
                    spacing={1}
                    mb={3}
                    maxH="200px"
                    overflowY="auto"
                  >
                    {savedViews.map((v) => (
                      <Flex
                        key={v.id}
                        align="center"
                        justify="space-between"
                        px={2}
                        py={1.5}
                        borderRadius="md"
                        cursor="pointer"
                        role="button"
                        tabIndex={0}
                        aria-label={`Apply saved view ${v.name}`}
                        _hover={{ bg: "neutral.50" }}
                        onClick={() => applyView(v)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            applyView(v);
                          }
                        }}
                        _focusVisible={{
                          outline: "2px solid",
                          outlineColor: "blue.400",
                          outlineOffset: "-2px",
                        }}
                      >
                        <Text fontSize="sm" color="neutral.800" noOfLines={1}>
                          {v.name}
                        </Text>
                        <IconButton
                          aria-label={`Delete view ${v.name}`}
                          icon={<FaTrash />}
                          size="xs"
                          variant="ghost"
                          colorScheme="red"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteView(v.id);
                          }}
                        />
                      </Flex>
                    ))}
                  </VStack>
                )}

                <Text
                  fontSize="xs"
                  fontWeight={700}
                  color="neutral.500"
                  textTransform="uppercase"
                  mb={2}
                >
                  Save current filters
                </Text>
                <HStack>
                  <Input
                    size="sm"
                    placeholder="e.g. My overdue P0s"
                    value={newViewName}
                    onChange={(e) => setNewViewName(e.target.value)}
                    isDisabled={!hasActiveFilters}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveView();
                    }}
                  />
                  <IconButton
                    aria-label="Save view"
                    icon={<FaBookmarkPlus />}
                    size="sm"
                    colorScheme="brand"
                    isDisabled={!hasActiveFilters || !newViewName.trim()}
                    onClick={handleSaveView}
                  />
                </HStack>
                {!hasActiveFilters && (
                  <Text fontSize="xs" color="neutral.500" mt={1.5}>
                    Set a search or filter first, then save it as a view.
                  </Text>
                )}
              </PopoverBody>
            </PopoverContent>
          </Portal>
        </Popover>

        <Box flex={1} />
        {selected.size > 0 && (
          <HStack spacing={2} bg="brand.50" px={3} py={1.5} borderRadius="md">
            <Text fontSize="sm" fontWeight={600} color="brand.700">
              {selected.size} selected
            </Text>
            <Select
              size="xs"
              maxW="130px"
              placeholder="Set status…"
              onChange={(e) => {
                bulkSetStatus(e.target.value);
                e.currentTarget.value = "";
              }}
            >
              <option value="todo">To Do</option>
              <option value="on-hold">On Hold</option>
              <option value="backlog">Backlog</option>
              <option value="done">Done</option>
            </Select>
            <ChakraButton
              size="xs"
              colorScheme="red"
              variant="outline"
              leftIcon={<FaTrash />}
              onClick={bulkDelete}
            >
              Delete
            </ChakraButton>
            <ChakraButton size="xs" variant="ghost" onClick={clearSelection}>
              Clear
            </ChakraButton>
          </HStack>
        )}
      </Flex>

      <Box overflowX="auto" w="100%">
      <Table
        variant="unstyled"
        sx={{ width: "max-content", minWidth: "100%", tableLayout: "auto" }}
      >
        <Thead bg="neutral.50">
          <Tr>
            <Th
              py={3.5}
              w={CHECKBOX_COL_W}
              position="sticky"
              left={0}
              zIndex={2}
              bg="neutral.50"
            >
              <Checkbox
                isChecked={allOnPageSelected}
                onChange={toggleAllOnPage}
                aria-label="Select all on page"
              />
            </Th>
            <Th
              py={3.5}
              fontSize="xs"
              color="neutral.500"
              letterSpacing="0.04em"
              w={TASK_COL_W}
              position="sticky"
              left={CHECKBOX_COL_W}
              zIndex={2}
              bg="neutral.50"
              borderRight="1px solid"
              borderColor="surface.border"
            >
              Task
            </Th>
            {[
              "Task Name",
              "Priority",
              "Assignee",
              "Duration",
              "Status",
              "Due Date",
              "Actions",
            ].map((h, i) => (
              <Th
                key={h}
                py={3.5}
                fontSize="xs"
                color="neutral.500"
                letterSpacing="0.04em"
                textAlign={i === 6 ? "right" : "left"}
              >
                {h}
              </Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>
          {tasks?.map((task) => {
            const sm = statusMeta(task.task_status);
            const done = ["done", "completed"].includes(
              (task.task_status || "").toLowerCase(),
            );
            return (
              <Tr
                key={task.id}
                role="group"
                borderTop="1px solid"
                borderColor="surface.border"
                transition="background 0.15s ease"
                _hover={{ bg: "neutral.50" }}
              >
                <Td
                  py={4}
                  w={CHECKBOX_COL_W}
                  position="sticky"
                  left={0}
                  zIndex={1}
                  bg="surface.card"
                  _groupHover={{ bg: "neutral.50" }}
                >
                  <Checkbox
                    isChecked={selected.has(task.id)}
                    onChange={() => toggleOne(task.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select ${task.task_name}`}
                  />
                </Td>
                <Td
                  py={4}
                  whiteSpace="nowrap"
                  w={TASK_COL_W}
                  position="sticky"
                  left={CHECKBOX_COL_W}
                  zIndex={1}
                  bg="surface.card"
                  _groupHover={{ bg: "neutral.50" }}
                  borderRight="1px solid"
                  borderColor="surface.border"
                >
                  {task.ticket_id && (
                    <Box
                      display="flex"
                      alignItems="center"
                      gap={1.5}
                      whiteSpace="nowrap"
                      cursor="pointer"
                      role="button"
                      tabIndex={0}
                      _hover={{ textDecoration: "underline" }}
                      aria-label={`Open task ${task.ticket_id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditTask(task);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          onEditTask(task);
                        }
                      }}
                    >
                      <Box
                        as={FaBookmark}
                        color="brand.600"
                        boxSize="12px"
                        fill="currentColor"
                      />
                      <Text fontSize="sm" fontWeight={700} color="brand.600">
                        {task.ticket_id}
                      </Text>
                    </Box>
                  )}
                </Td>
                <Td py={4}>
                  <Text
                    fontSize="sm"
                    fontWeight={600}
                    color="neutral.900"
                    textDecoration={done ? "line-through" : "none"}
                  >
                    {task.task_name}
                  </Text>
                  {task.task_tags && (
                    <Text fontSize="xs" color="neutral.500">
                      {task.task_tags}
                    </Text>
                  )}
                  {!!task.subtask_total && (
                    <Badge
                      mt={1}
                      colorScheme={
                        task.subtask_done === task.subtask_total ? "green" : "gray"
                      }
                      fontSize="0.6rem"
                    >
                      {task.subtask_done || 0}/{task.subtask_total} subtasks
                    </Badge>
                  )}
                </Td>
                <Td whiteSpace="nowrap">
                  <Badge
                    colorScheme={getPriorityColor(task.task_priority as string)}
                  >
                    {task.task_priority}
                  </Badge>
                </Td>
                <Td onClick={(e) => e.stopPropagation()} maxW="200px">
                  <AssigneePicker
                    value={task.task_assigned_to}
                    onChange={(empId) => handleAssigneeChange(task, empId)}
                    developers={developers}
                    size="sm"
                    placeholder="Unassigned"
                  />
                </Td>
                <Td whiteSpace="nowrap">
                  <Text fontSize="sm" color="neutral.600" whiteSpace="nowrap">
                    {formatDuration(task.task_duration)}
                  </Text>
                </Td>
                <Td whiteSpace="nowrap">
                  <HStack spacing={2}>
                    <Box w="8px" h="8px" borderRadius="full" bg={sm.color} flexShrink={0} />
                    <Text fontSize="sm" color="neutral.700" whiteSpace="nowrap">
                      {sm.label}
                    </Text>
                  </HStack>
                </Td>
                <Td whiteSpace="nowrap">
                  <Text fontSize="sm" color="neutral.500" whiteSpace="nowrap">
                    {task.task_due_date
                      ? new Date(task.task_due_date).toLocaleDateString()
                      : task.task_created_at
                        ? new Date(task.task_created_at).toLocaleDateString()
                        : "—"}
                  </Text>
                </Td>
                <Td whiteSpace="nowrap" textAlign="right">
                  <Tooltip label="Edit Task">
                    <IconButton
                      aria-label="Edit task"
                      icon={<FaEdit />}
                      size="sm"
                      colorScheme="gray"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditTask(task);
                      }}
                    />
                  </Tooltip>
                  <Tooltip label="Delete Task">
                    <IconButton
                      aria-label="Delete task"
                      icon={<FaTrash />}
                      size="sm"
                      colorScheme="red"
                      variant="ghost"
                      ml={1}
                      onClick={(e) => handleDelete(e, task.id)}
                    />
                  </Tooltip>
                </Td>
              </Tr>
            );
          })}
          {tasks.length === 0 && (
            <Tr>
              <Td colSpan={9} textAlign="center" py={10} color="neutral.500">
                No tasks found.{" "}
                {hasActiveFilters
                  ? "Try clearing filters."
                  : "Create one to get started."}
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
      </Box>

      {/* Pagination */}
      <HStack
        justify="space-between"
        px={5}
        py={4}
        borderTop="1px solid"
        borderColor="surface.border"
      >
        <Text fontSize="sm" color="neutral.500">
          Showing {tasks.length} of {totalItems} tasks
        </Text>
        <HStack>
          <ChakraButton
            size="sm"
            variant="outline"
            onClick={handlePrev}
            isDisabled={page === 1}
            isLoading={isFetching}
          >
            Previous
          </ChakraButton>
          <Text fontSize="sm" color="neutral.600" px={2}>
            {page} / {totalPages}
          </Text>
          <ChakraButton
            size="sm"
            variant="outline"
            onClick={handleNext}
            isDisabled={page >= totalPages}
            isLoading={isFetching}
          >
            Next
          </ChakraButton>
        </HStack>
      </HStack>
    </Box>
  );
};

export default TaskListingView;
