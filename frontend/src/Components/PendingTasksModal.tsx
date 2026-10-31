import React, { useMemo } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  VStack,
  Text,
  Button,
  Badge,
  Flex,
  Box,
  useToast,
  Icon,
} from "@chakra-ui/react";
import {
  FaClock,
  FaCalendarAlt,
  FaCheck,
  FaExclamationCircle,
} from "Utils/icons";
import { useAppDispatch, useAppSelector } from "app/hooks";
import { Task } from "types";
import { useUpdateTaskMutation } from "Services/user.api";
import { updateTask } from "app/slices/scheduler.slice";
import { formatDuration } from "Utils/common";
import { getPriorityColor } from "Utils/priority";
import AttachmentThumbnails from "Components/Timeline/AttachmentThumbnails";
import { useTaskDetail } from "Contexts/useTaskDetail";
import { PANEL_BG } from "Components/Timeline/taskModalStyles";

interface PendingTasksModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PendingTasksModal: React.FC<PendingTasksModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { tasks, currentUser, config } = useAppSelector(
    (state) => state.scheduler,
  );
  const dispatch = useAppDispatch();
  const [updateTaskApi] = useUpdateTaskMutation();
  const toast = useToast();
  const { openTaskDetail } = useTaskDetail();

  const pendingTasks = useMemo(() => {
    if (!currentUser) return [];

    const now = new Date();
    const currentHour = now.getHours() + now.getMinutes() / 60;

    // Condition: If working hours are over, pending tasks are deferred to next day.
    // User requested: "while my working hours is completed i should get this option on next working day start time"
    if (currentHour >= config.endHour) {
      return [];
    }

    // Filter tasks for current user that are backlog/todo/on-hold — explicitly excludes
    // done/completed (not just relying on the allowlist) so a completed task never lingers here.
    const userTasks = tasks.filter((t) => {
      if (t.task_assigned_to !== currentUser.emp_id) return false;
      const s = (t.task_status || "").toLowerCase();
      if (s === "done" || s === "completed") return false;
      return s === "backlog" || s === "todo" || s === "on-hold";
    });

    // Helper to get effective start date
    const getEffectiveStartDate = (t: Task) => {
      // 1. Explicit Assigned Date
      if (t.task_assigned_date) {
        return new Date(t.task_assigned_date);
      }
      // 2. Created At (Fallback)
      const created = t.task_created_at
        ? new Date(t.task_created_at)
        : new Date();

      /** Use Scheduler Config */
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

        // Condition 1: Must be actionable TODAY or in PAST (Exception)
        // We filter out strictly FUTURE DAYS (Tomorrow onwards)
        const tomorrowMidnight = new Date(todayMidnight);
        tomorrowMidnight.setDate(tomorrowMidnight.getDate() + 1);

        if (effectiveStart >= tomorrowMidnight) return false;

        // Condition 2: Must not be from strict past (before today 00:00)
        // EXCEPTION: "on-hold" tasks persist as pending actions regardless of start date
        if (t.task_status !== "on-hold") {
          if (effectiveStart < todayMidnight) return false;
        }

        return true;
      })
      .sort((a, b) => {
        // ... (sort logic remains)
        const priorityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
        const pA = priorityOrder[a.task_priority as string] ?? 2;
        const pB = priorityOrder[b.task_priority as string] ?? 2;

        if (pA !== pB) return pA - pB;

        const tA = getEffectiveStartDate(a).getTime();
        const tB = getEffectiveStartDate(b).getTime();
        return tA - tB;
      });
  }, [tasks, currentUser, config]);

  const handlePickTask = async (task: Task) => {
    try {
      const updatedTask = {
        ...task,
        task_status: "in-progress",
        task_updated_at: new Date().toISOString(),
        task_assigned_date: new Date().toISOString(), // Reset start time for simulation
      };

      // Backend auto-holds any other in-progress task for this user server-side (same
      // preemption logic as the timeline's Pick/Resume) — mirror that optimistically here too,
      // same as TimelineView.handlePickFromTimeline, so the UI doesn't show two active tasks
      // until the next refetch/websocket sync reconciles it.
      const active = tasks.find(
        (t) =>
          currentUser &&
          t.task_assigned_to === currentUser.emp_id &&
          t.id !== task.id &&
          ["in-progress", "in progress"].includes((t.task_status || "").toLowerCase()),
      );
      if (active) dispatch(updateTask({ ...active, task_status: "on-hold" }));
      dispatch(updateTask(updatedTask));

      const resp = await updateTaskApi(updatedTask).unwrap();
      dispatch(updateTask(resp || updatedTask));

      toast({
        title: "Task Picked",
        description: `${task.task_name} has been added to your timeline.`,
        status: "success",
        duration: 3000,
        isClosable: true,
      });

      if (pendingTasks.length <= 1) {
        onClose();
      }
    } catch {
      toast({
        title: "Error",
        description: "Failed to pick task.",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="3xl" scrollBehavior="inside">
      <ModalOverlay backdropFilter="blur(5px)" bg="blackAlpha.300" />
      <ModalContent
        bg="white"
        borderRadius="1rem"
        boxShadow="0 32px 64px -12px rgba(0,0,0,0.14)"
        overflow="hidden"
      >
        <ModalHeader borderBottom="1px solid" borderColor="surface.border" px={8} py={6}>
          <Flex align="center" gap={3}>
            <Flex
              w="40px"
              h="40px"
              borderRadius="0.75rem"
              align="center"
              justify="center"
              bg="orange.50"
              color="orange.600"
              flexShrink={0}
            >
              <Icon as={FaExclamationCircle} boxSize={5} />
            </Flex>
            <Box>
              <Text fontSize="lg" fontWeight={700} color="neutral.900">
                Pending Tasks
              </Text>
              <Text fontSize="sm" color="neutral.500">
                {pendingTasks.length > 0
                  ? `You have ${pendingTasks.length} unpicked ${pendingTasks.length === 1 ? "task" : "tasks"}. Please prioritize them.`
                  : "No tasks waiting for your attention."}
              </Text>
            </Box>
          </Flex>
        </ModalHeader>
        <ModalCloseButton top={6} right={8} />
        <ModalBody py={6} px={8} bg={PANEL_BG}>
          {pendingTasks.length === 0 ? (
            <Flex direction="column" align="center" justify="center" p={8}>
              <Icon as={FaCheck} color="green.400" boxSize={10} mb={3} />
              <Text color="neutral.600" fontWeight={500}>
                You're all caught up! No pending tasks.
              </Text>
            </Flex>
          ) : (
            <VStack spacing={3} align="stretch">
              {pendingTasks.map((task, index) => {
                const isFirst = index === 0;
                const priorityColor = getPriorityColor(task.task_priority);

                return (
                  <Flex
                    key={task.id}
                    p={4}
                    bg="white"
                    borderRadius="0.75rem"
                    borderWidth="1px"
                    borderColor={isFirst ? `${priorityColor}.200` : "surface.border"}
                    boxShadow={isFirst ? "sm" : "none"}
                    transition="all 0.2s"
                    cursor="pointer"
                    role="button"
                    tabIndex={0}
                    align="center"
                    justify="space-between"
                    gap={4}
                    onClick={() => openTaskDetail(task)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openTaskDetail(task);
                      }
                    }}
                    _hover={{ borderColor: "brand.300", boxShadow: "sm" }}
                    _focusVisible={{ outline: "2px solid", outlineColor: "blue.400", outlineOffset: "1px" }}
                  >
                    <Box flex={1} minW={0}>
                      <Flex align="center" gap={3} wrap="wrap">
                        <Text fontWeight={700} color="neutral.900" noOfLines={1}>
                          {task.task_name}
                        </Text>
                        {task.task_priority && (
                          <Badge colorScheme={priorityColor} fontSize="xs" borderRadius="pill" px={2}>
                            {task.task_priority}
                          </Badge>
                        )}
                        <Flex align="center" gap={1} color="neutral.500" fontSize="xs">
                          <Icon as={FaClock} />
                          <Text>{formatDuration(task.task_duration || 1)} est.</Text>
                        </Flex>
                        {task.task_due_date && (
                          <Flex align="center" gap={1} color="neutral.500" fontSize="xs">
                            <Icon as={FaCalendarAlt} />
                            <Text>{new Date(task.task_due_date).toLocaleDateString()}</Text>
                          </Flex>
                        )}
                        {!!task.subtask_total && (
                          <Badge
                            colorScheme={
                              task.subtask_done === task.subtask_total ? "green" : "gray"
                            }
                            fontSize="xs"
                            borderRadius="pill"
                            px={2}
                          >
                            {task.subtask_done || 0}/{task.subtask_total} subtasks
                          </Badge>
                        )}
                      </Flex>
                      {task.task_description && (
                        <Text fontSize="sm" color="neutral.500" noOfLines={1} mt={1}>
                          {task.task_description}
                        </Text>
                      )}
                      <Box mt={2}>
                        <AttachmentThumbnails taskId={task.id} />
                      </Box>
                    </Box>
                    <Button
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePickTask(task);
                      }}
                      leftIcon={<FaCheck />}
                      flexShrink={0}
                    >
                      Pick
                    </Button>
                  </Flex>
                );
              })}
            </VStack>
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};

export default PendingTasksModal;
