import React, { useEffect, useState } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  Button,
  FormControl,
  FormLabel,
  Input,
  Textarea,
  Select,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  NumberIncrementStepper,
  NumberDecrementStepper,
  VStack,
  useToast,
  HStack,
  Checkbox,
  Grid,
  GridItem,
  Box,
  Text,
  Flex,
  IconButton,
  Badge,
} from "@chakra-ui/react";
import { FaTimes, FaPlus, FaBookmark, FaTrash } from "Utils/icons";
import { useAppDispatch, useAppSelector } from "app/hooks";
import { addTask } from "app/slices/scheduler.slice";
import { Priority, Task, StagedAttachment } from "types";
import { PRIORITY_OPTIONS, PRIORITY_LABEL, getPriorityColor } from "Utils/priority";
import {
  useCreateTaskMutation,
  useAddTaskLinkMutation,
} from "Services/user.api";
import AssigneePicker from "Components/Timeline/AssigneePicker";
import AssigneeSuggestions from "Components/Timeline/AssigneeSuggestions";
import EpicPicker from "Components/Timeline/EpicPicker";
import SprintPicker from "Components/Timeline/SprintPicker";
import TagsInput from "Components/Timeline/TagsInput";
import TaskAttachments from "Components/Timeline/TaskAttachments";
import SubtaskCreationModal, {
  SubtaskDraft,
} from "Components/Timeline/SubtaskCreationModal";
import { getApiErrorMessage } from "Services/baseQuery";
import {
  LABEL_PROPS,
  softFieldProps,
  cardFieldProps,
  sidebarPanelProps,
} from "Components/Timeline/taskModalStyles";

/** "YYYY-MM-DD" (from a date input) -> ISO instant at end-of-day LOCAL time, so a due date
 * doesn't silently roll back a day when converted to UTC. Empty input -> undefined (clears it). */
const dueDateToIso = (yyyyMmDd: string): string | undefined =>
  yyyyMmDd ? new Date(`${yyyyMmDd}T23:59:59`).toISOString() : undefined;

interface StagedLink {
  targetId: string;
  targetName: string;
}

/** A subtask fully filled out via its own `SubtaskCreationModal`, staged locally until the
 * parent's own "Create Task" submits everything in one atomic `POST /tasks` call. */
interface StagedSubtask extends SubtaskDraft {
  tempId: string;
}

interface TaskCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Create-a-new-task modal — viewing/editing an EXISTING task goes through `TaskDetailModal`
 * instead (see `Contexts/TaskDetailContext`), which also carries comments/links/live attachments
 * that only make sense once a task actually exists. */
const TaskCreationModal: React.FC<TaskCreationModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [createTask, { isLoading: isSubmitting }] = useCreateTaskMutation();
  const [addTaskLink] = useAddTaskLinkMutation();
  const dispatch = useAppDispatch();
  const developers = useAppSelector((state) => state.scheduler.developers);
  const allTasks = useAppSelector((state) => state.scheduler.tasks);
  const currentUser = useAppSelector((state) => state.scheduler.currentUser);
  const toast = useToast();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // Fed to AssigneeSuggestions instead of the live `title`/`description` above — a non-trivial
  // description makes the backend run a real Gemini call server-side, so BOTH fields are only
  // "committed" (and the suggestions query re-run) once that specific field is blurred, never on
  // a keystroke in either one. Blurring title fires with whatever description was last committed
  // (possibly still ""), blurring description fires with whatever title was last committed, and
  // typing in one field never re-triggers a request while the other is mid-edit.
  const [committedTitle, setCommittedTitle] = useState("");
  const [committedDescription, setCommittedDescription] = useState("");
  const [tags, setTags] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [durationHours, setDurationHours] = useState(0);
  const [durationMinutes, setDurationMinutes] = useState(0);
  const [priority, setPriority] = useState<Priority>("P1");
  const [status, setStatus] = useState<string>("todo");
  const [assigneeId, setAssigneeId] = useState("");
  const [epicId, setEpicId] = useState<string | undefined>(undefined);
  const [sprintId, setSprintId] = useState<string | undefined>(undefined);
  const [isEod, setIsEod] = useState(false);
  const [stagedAttachments, setStagedAttachments] = useState<
    StagedAttachment[]
  >([]);
  const [stagedLinks, setStagedLinks] = useState<StagedLink[]>([]);
  const [linkTarget, setLinkTarget] = useState("");
  const [showLinkAdder, setShowLinkAdder] = useState(false);
  const [stagedSubtasks, setStagedSubtasks] = useState<StagedSubtask[]>([]);
  const [subtaskModalOpen, setSubtaskModalOpen] = useState(false);

  const { config } = useAppSelector((state) => state.scheduler);

  const handleEodCheck = (checked: boolean) => {
    setIsEod(checked);
    if (checked) {
      const now = new Date();
      const currentHour = now.getHours() + now.getMinutes() / 60;
      const endHour = config.endHour;

      const remaining = Math.max(0, endHour - currentHour);
      const hours = Math.floor(remaining);
      const minutes = Math.round((remaining - hours) * 60);

      setDurationHours(hours);
      setDurationMinutes(minutes);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setTitle("");
    setCommittedTitle("");
    setDescription("");
    setCommittedDescription("");
    setTags("");
    setDueDate("");
    setDurationHours(0);
    setDurationMinutes(0);
    setPriority("P1");
    setStatus("todo");
    setIsEod(false);
    setStagedAttachments([]);
    setStagedLinks([]);
    setLinkTarget("");
    setShowLinkAdder(false);
    setStagedSubtasks([]);
    setSubtaskModalOpen(false);
    setAssigneeId(currentUser?.emp_id || "");
    setEpicId(undefined);
    setSprintId(undefined);
  }, [isOpen, currentUser]);

  const addStagedLink = () => {
    if (!linkTarget) return;
    const target = allTasks.find((t) => t.id === linkTarget);
    if (!target || stagedLinks.some((l) => l.targetId === linkTarget)) return;
    setStagedLinks((prev) => [
      ...prev,
      { targetId: target.id, targetName: target.task_name },
    ]);
    setLinkTarget("");
    setShowLinkAdder(false);
  };

  const addStagedSubtask = (draft: SubtaskDraft) => {
    setStagedSubtasks((prev) => [
      ...prev,
      { tempId: `${prev.length}-${draft.assigneeId}-${Date.now()}`, ...draft },
    ]);
  };

  const handleSubmit = async () => {
    if (!title) {
      toast({ title: "Title is required", status: "error" });
      return;
    }

    if (!assigneeId) {
      toast({
        title: "Assignee is required",
        description: "Please select a user to assign the task.",
        status: "error",
      });
      return;
    }

    const totalNewMinutes =
      Number(durationHours) * 60 + Number(durationMinutes);
    if (totalNewMinutes < 10) {
      toast({
        title: "Task duration must be at least 10 minutes.",
        status: "error",
      });
      return;
    }
    const finalDuration = `${String(durationHours).padStart(2, "0")}:${String(
      durationMinutes,
    ).padStart(2, "0")}`;
    // No client-side id: the backend generates and returns the authoritative task.
    const newTask: Partial<Task> = {
      task_name: title,
      task_description: description,
      task_tags: tags || undefined,
      task_due_date: dueDateToIso(dueDate),
      task_duration: String(finalDuration),
      task_priority: priority,
      task_assigned_to: assigneeId,
      task_assigned_by: currentUser?.emp_id,
      task_status: status,
      task_created_at: new Date().toISOString(),
      epic_id: epicId,
      sprint_id: sprintId,
      // Sent inline (not uploaded separately after create) so they're already saved by the
      // time the backend sends the assignment email.
      attachments: stagedAttachments.length
        ? stagedAttachments.map((f) => ({
            filename: f.filename,
            content_type: f.content_type,
            data: f.data,
          }))
        : undefined,
      // Created atomically with the parent server-side (not a staged-then-post-create loop
      // like Linked Tasks below) — a collaborator told they own a piece that doesn't exist
      // is a worse failure than a missing dependency link.
      subtasks: stagedSubtasks.length
        ? stagedSubtasks.map((s) => ({
            task_name: s.task_name,
            task_assigned_to: s.assigneeId,
            task_description: s.task_description,
            task_status: s.task_status,
            task_priority: s.task_priority,
            task_tags: s.task_tags,
            task_duration: s.task_duration,
            task_due_date: s.task_due_date,
            attachments: s.attachments?.length
              ? s.attachments.map((f) => ({
                  filename: f.filename,
                  content_type: f.content_type,
                  data: f.data,
                }))
              : undefined,
          }))
        : undefined,
    };

    const resp = await createTask(newTask);
    if (resp?.data) {
      dispatch(addTask([...allTasks, resp.data]));
      // Staged dependencies can only be linked once the real task id exists — same
      // "stage locally, commit right after create" pattern as attachments.
      let failedLinks: StagedLink[] = [];
      if (stagedLinks.length) {
        const results = await Promise.all(
          stagedLinks.map((l) =>
            addTaskLink({
              taskId: resp.data.id,
              to_task_id: l.targetId,
              link_type: "depends_on",
            })
              .then(() => null)
              .catch(() => l),
          ),
        );
        failedLinks = results.filter((l): l is StagedLink => l !== null);
      }
      setStagedAttachments([]);
      setStagedLinks([]);
      setStagedSubtasks([]);
      toast({ title: "Task created successfully.", status: "success" });
      if (failedLinks.length) {
        toast({
          title: "Some dependencies couldn't be linked",
          description: `Failed to link: ${failedLinks.map((l) => l.targetName).join(", ")}. You can add them from the task detail view.`,
          status: "warning",
          duration: 6000,
        });
      }
      if (resp.data.subtask_warning) {
        toast({
          title: "Some subtasks failed",
          description: `${resp.data.subtask_warning} You can add them from the task detail view.`,
          status: "warning",
          duration: 6000,
        });
      }
      onClose();
    } else {
      toast({
        title: "Failed to create task",
        description:
          getApiErrorMessage(resp?.error) ||
          "Please try again.",
        status: "error",
      });
    }
  };

  const canInProgress =
    currentUser?.emp_designation?.toUpperCase() === "L1" ||
    status === "in-progress";
  const canDone =
    currentUser?.emp_designation?.toUpperCase() === "L1" || status === "done";

  const STATUS_OPTIONS = [
    { value: "backlog", label: "Backlog", show: true },
    { value: "todo", label: "To Do", show: true },
    { value: "in-progress", label: "In Progress", show: canInProgress },
    { value: "done", label: "Done", show: canDone },
  ].filter((o) => o.show);

  const linkOptions = allTasks.filter(
    (t) => !stagedLinks.some((l) => l.targetId === t.id),
  );

  return (
    <>
    <Modal isOpen={isOpen} onClose={onClose} size="5xl" scrollBehavior="inside">
      <ModalOverlay bg="rgba(15,23,42,0.3)" backdropFilter="blur(12px)" />
      <ModalContent
        borderRadius="1rem"
        boxShadow="0 32px 64px -12px rgba(0,0,0,0.14)"
        overflow="hidden"
        h={{ base: "100vh", md: "85vh" }}
        maxH="85vh"
        display="flex"
        flexDirection="column"
      >
        {/* Header — never scrolls */}
        <Flex
          justify="space-between"
          align="start"
          px={6}
          py={6}
          flexShrink={0}
        >
          <Box>
            <Text
              fontSize="2xl"
              fontWeight={700}
              letterSpacing="-0.01em"
              color="neutral.900"
            >
              Create New Task
            </Text>
            <Text fontSize="sm" color="neutral.500" mt={1}>
              Specify your goals and requirements below
            </Text>
          </Box>
          <IconButton
            aria-label="Close"
            icon={<FaTimes />}
            variant="ghost"
            borderRadius="full"
            onClick={onClose}
            _active={{ transform: "scale(0.95)" }}
          />
        </Flex>

        {/* Body — the only scroll region */}
        <Box flex={1} minH={0} overflowY="auto" px={10} pb={10}>
          <Grid templateColumns={{ base: "1fr", lg: "2fr 1fr" }} gap={12}>
            {/* Left column */}
            <GridItem>
              <VStack spacing={10} align="stretch">
                <FormControl isRequired>
                  <FormLabel {...LABEL_PROPS}>Title</FormLabel>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onBlur={() => setCommittedTitle(title)}
                    placeholder="Task name..."
                    fontWeight={600}
                    {...softFieldProps}
                  />
                </FormControl>

                <FormControl>
                  <FormLabel {...LABEL_PROPS}>Description</FormLabel>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    onBlur={() => setCommittedDescription(description)}
                    placeholder="What needs to be done?"
                    rows={6}
                    resize="none"
                    {...softFieldProps}
                  />
                </FormControl>

                <FormControl>
                  <FormLabel {...LABEL_PROPS}>Reference Materials</FormLabel>
                  <TaskAttachments
                    variant="dropzone"
                    staged={stagedAttachments}
                    onStagedChange={setStagedAttachments}
                  />
                </FormControl>

                <FormControl>
                  <FormLabel {...LABEL_PROPS}>Subtasks</FormLabel>
                  <Text fontSize="xs" color="neutral.500" mb={3}>
                    Split this across collaborators — e.g. frontend to one teammate, backend
                    to another. This task's progress rolls up from these.
                  </Text>
                  <VStack align="stretch" spacing={2}>
                    {stagedSubtasks.map((s) => {
                      const dev = developers.find((d) => d.emp_id === s.assigneeId);
                      return (
                        <Flex
                          key={s.tempId}
                          align="center"
                          justify="space-between"
                          gap={3}
                          p={3}
                          bg="white"
                          border="1px solid"
                          borderColor="#f3f4f6"
                          borderRadius="0.75rem"
                          boxShadow="sm"
                        >
                          <Flex align="center" gap={2} minW={0} flex={1}>
                            <Box
                              as={FaBookmark}
                              color="brand.600"
                              boxSize="12px"
                              flexShrink={0}
                              fill="currentColor"
                            />
                            <Badge
                              colorScheme="gray"
                              fontSize="0.6rem"
                              flexShrink={0}
                            >
                              NEW
                            </Badge>
                            <Box minW={0}>
                              <Text
                                fontSize="sm"
                                fontWeight={700}
                                color="neutral.900"
                                isTruncated
                              >
                                {s.task_name}
                              </Text>
                              {s.task_description && (
                                <Text fontSize="xs" color="neutral.500" isTruncated>
                                  {s.task_description}
                                </Text>
                              )}
                            </Box>
                          </Flex>
                          <Flex align="center" gap={2} flexShrink={0}>
                            <Badge colorScheme={getPriorityColor(s.task_priority)} fontSize="0.65rem">
                              {s.task_priority}
                            </Badge>
                            <Text fontSize="xs" fontWeight={600} color="neutral.700" isTruncated maxW="120px">
                              {dev?.emp_name || s.assigneeId}
                            </Text>
                            <IconButton
                              aria-label="Remove subtask"
                              icon={<FaTrash size="14" />}
                              size="xs"
                              variant="ghost"
                              color="neutral.500"
                              _hover={{ color: "red.500" }}
                              onClick={() =>
                                setStagedSubtasks((prev) =>
                                  prev.filter((x) => x.tempId !== s.tempId),
                                )
                              }
                            />
                          </Flex>
                        </Flex>
                      );
                    })}

                    <Box
                      as="button"
                      type="button"
                      onClick={() => setSubtaskModalOpen(true)}
                      color="brand.600"
                      fontSize="xs"
                      fontWeight={600}
                      display="flex"
                      alignItems="center"
                      gap={1.5}
                      mt={1}
                      _hover={{ textDecoration: "underline" }}
                    >
                      <FaPlus size="16" /> Add Subtask
                    </Box>
                  </VStack>
                </FormControl>
              </VStack>
            </GridItem>

            {/* Right column */}
            <GridItem>
              <Box {...sidebarPanelProps} p={6}>
                <VStack spacing={5} align="stretch">
                  <FormControl>
                    <FormLabel {...LABEL_PROPS}>Assignee</FormLabel>
                    <VStack spacing={3} align="stretch">
                      <AssigneeSuggestions
                        tags={tags}
                        priority={priority}
                        title={committedTitle}
                        description={committedDescription}
                        developers={developers}
                        selectedId={assigneeId}
                        onSelect={setAssigneeId}
                      />
                      <AssigneePicker
                        value={assigneeId}
                        onChange={setAssigneeId}
                        developers={developers}
                      />
                    </VStack>
                  </FormControl>

                  <Grid templateColumns="1fr 1fr" gap={3}>
                    <FormControl>
                      <FormLabel {...LABEL_PROPS}>Priority</FormLabel>
                      <Select
                        value={priority}
                        onChange={(e) =>
                          setPriority(e.target.value as Priority)
                        }
                        {...cardFieldProps}
                      >
                        {PRIORITY_OPTIONS.map((p) => (
                          <option key={p} value={p} title={PRIORITY_LABEL[p]}>
                            {p}
                          </option>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl>
                      <FormLabel {...LABEL_PROPS}>Status</FormLabel>
                      <Select
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                        {...cardFieldProps}
                      >
                        {STATUS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>

                  <Grid templateColumns="1fr 1fr" gap={3}>
                    <FormControl>
                      <FormLabel {...LABEL_PROPS}>Epic</FormLabel>
                      <EpicPicker value={epicId} onChange={setEpicId} />
                    </FormControl>
                    <FormControl>
                      <FormLabel {...LABEL_PROPS}>Sprint</FormLabel>
                      <SprintPicker value={sprintId} onChange={setSprintId} />
                    </FormControl>
                  </Grid>

                  <FormControl>
                    <FormLabel {...LABEL_PROPS}>Deadline</FormLabel>
                    <Input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      px={4}
                      py={3}
                      {...cardFieldProps}
                    />
                  </FormControl>

                  <FormControl isRequired>
                    <HStack spacing={3} align="flex-end">
                      <Box>
                        <FormLabel {...LABEL_PROPS}>Hours</FormLabel>

                        <NumberInput
                          min={0}
                          max={100}
                          value={durationHours}
                          onChange={(val) => setDurationHours(Number(val))}
                          isDisabled={isEod}
                        >
                          <NumberInputField
                            {...cardFieldProps}
                            px={3}
                            py={2.5}
                          />
                          <NumberInputStepper>
                            <NumberIncrementStepper />
                            <NumberDecrementStepper />
                          </NumberInputStepper>
                        </NumberInput>
                      </Box>
                      <Box>
                        <FormLabel {...LABEL_PROPS}>Minutes</FormLabel>

                        <NumberInput
                          min={0}
                          max={59}
                          value={durationMinutes}
                          onChange={(val) => setDurationMinutes(Number(val))}
                          isDisabled={isEod}
                        >
                          <NumberInputField
                            {...cardFieldProps}
                            px={3}
                            py={2.5}
                          />
                          <NumberInputStepper>
                            <NumberIncrementStepper />
                            <NumberDecrementStepper />
                          </NumberInputStepper>
                        </NumberInput>
                      </Box>
                    </HStack>
                    <Checkbox
                      isChecked={isEod}
                      onChange={(e) => handleEodCheck(e.target.checked)}
                      size="sm"
                      colorScheme="brand"
                      mt={2}
                    >
                      Till End of Day
                    </Checkbox>
                  </FormControl>

                  <FormControl>
                    <FormLabel {...LABEL_PROPS}>Tags</FormLabel>
                    <TagsInput
                      value={tags}
                      onChange={setTags}
                      addLabel="+ New"
                    />
                  </FormControl>

                  <Box
                    pt={4}
                    borderTop="1px solid"
                    borderColor="rgba(229,231,235,0.6)"
                  >
                    <FormLabel {...LABEL_PROPS} mb={3}>
                      Linked Tasks
                    </FormLabel>
                    <VStack align="stretch" spacing={2}>
                      {stagedLinks.map((l) => (
                        <Flex
                          key={l.targetId}
                          align="center"
                          justify="space-between"
                          p={3}
                          bg="white"
                          border="1px solid"
                          borderColor="#f3f4f6"
                          borderRadius="0.75rem"
                          boxShadow="sm"
                        >
                          <Text
                            fontSize="xs"
                            fontWeight={500}
                            color="neutral.900"
                            isTruncated
                          >
                            {l.targetName}
                          </Text>
                          <IconButton
                            aria-label="Remove dependency"
                            icon={<FaTimes size="16" />}
                            size="xs"
                            variant="ghost"
                            color="neutral.500"
                            _hover={{ color: "red.500" }}
                            onClick={() =>
                              setStagedLinks((prev) =>
                                prev.filter((x) => x.targetId !== l.targetId),
                              )
                            }
                          />
                        </Flex>
                      ))}

                      {showLinkAdder ? (
                        <HStack spacing={2}>
                          <Select
                            size="sm"
                            placeholder="Select task…"
                            value={linkTarget}
                            onChange={(e) => setLinkTarget(e.target.value)}
                            {...cardFieldProps}
                          >
                            {linkOptions.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.task_name}
                              </option>
                            ))}
                          </Select>
                          <IconButton
                            aria-label="Confirm dependency"
                            icon={<FaPlus />}
                            size="sm"
                            colorScheme="brand"
                            borderRadius="0.75rem"
                            onClick={addStagedLink}
                            isDisabled={!linkTarget}
                            flexShrink={0}
                          />
                        </HStack>
                      ) : (
                        <Box
                          as="button"
                          type="button"
                          onClick={() => setShowLinkAdder(true)}
                          color="brand.600"
                          fontSize="xs"
                          fontWeight={600}
                          display="flex"
                          alignItems="center"
                          gap={1.5}
                          mt={1}
                          _hover={{ textDecoration: "underline" }}
                        >
                          <FaPlus size="16" /> Add dependency
                        </Box>
                      )}
                    </VStack>
                  </Box>
                </VStack>
              </Box>
            </GridItem>
          </Grid>
        </Box>

        {/* Footer — never scrolls */}
        <Flex
          justify="flex-end"
          align="center"
          gap={4}
          px={10}
          py={6}
          borderTop="1px solid"
          borderColor="#f3f4f6"
          bg="rgba(249,250,251,0.5)"
          flexShrink={0}
        >
          <Button
            variant="ghost"
            px={8}
            py={3}
            h="auto"
            borderRadius="0.75rem"
            color="neutral.600"
            fontWeight={600}
            onClick={onClose}
            _hover={{ bg: "neutral.100" }}
            _active={{ transform: "scale(0.95)" }}
          >
            Discard
          </Button>
          <Button
            bg="brand.600"
            color="white"
            px={10}
            py={3}
            h="auto"
            borderRadius="0.75rem"
            fontWeight={600}
            boxShadow="0 8px 20px -4px rgba(37,99,235,0.3)"
            _hover={{ filter: "brightness(1.1)" }}
            _active={{ transform: "scale(0.95)" }}
            onClick={handleSubmit}
            isLoading={isSubmitting}
            loadingText="Creating..."
          >
            Create Task
          </Button>
        </Flex>
      </ModalContent>
    </Modal>
    <SubtaskCreationModal
      isOpen={subtaskModalOpen}
      onClose={() => setSubtaskModalOpen(false)}
      onAdd={addStagedSubtask}
      defaultPriority={priority}
    />
    </>
  );
};

export default TaskCreationModal;
