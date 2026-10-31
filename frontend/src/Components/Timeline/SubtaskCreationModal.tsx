import React, { useEffect, useRef, useState } from "react";
import {
  Portal,
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
} from "@chakra-ui/react";
import { FaTimes } from "Utils/icons";
import { useAppSelector } from "app/hooks";
import { Priority, StagedAttachment } from "types";
import { PRIORITY_OPTIONS, PRIORITY_LABEL } from "Utils/priority";
import AssigneePicker from "Components/Timeline/AssigneePicker";
import AssigneeSuggestions from "Components/Timeline/AssigneeSuggestions";
import TagsInput from "Components/Timeline/TagsInput";
import TaskAttachments from "Components/Timeline/TaskAttachments";
import {
  LABEL_PROPS,
  softFieldProps,
  cardFieldProps,
  sidebarPanelProps,
} from "Components/Timeline/taskModalStyles";

const dueDateToIso = (yyyyMmDd: string): string | undefined =>
  yyyyMmDd ? new Date(`${yyyyMmDd}T23:59:59`).toISOString() : undefined;

export interface SubtaskDraft {
  task_name: string;
  task_description?: string;
  task_status: string;
  task_priority: Priority;
  task_tags?: string;
  task_duration: string;
  task_due_date?: string;
  assigneeId: string;
  attachments?: StagedAttachment[];
}

interface SubtaskCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (draft: SubtaskDraft) => void;
  /** Prefilled from the parent story so a subtask defaults to matching context, not zeroed out. */
  defaultPriority?: Priority;
}

/** Full-detail sub-modal opened either from the create-task modal's "Subtasks" panel, or from
 * an existing task's detail view — same fields as `TaskCreationModal`
 * (title/description/attachments/assignee/priority/status/deadline/duration/tags), minus its
 * own Subtasks panel (nesting is capped at 1 level, see `check_subtask_depth` server-side) and
 * minus Linked Tasks (a dependency picker needs OTHER existing tasks to point at — orthogonal to
 * "fill in this subtask's own details").
 *
 * Deliberately a custom `Portal` overlay, NOT a nested Chakra `<Modal>` — both call sites open
 * this while another real Chakra `Modal` (`TaskCreationModal` or `TaskDetailModal`) is already
 * mounted underneath, and this codebase already hit the exact failure mode that causes: two
 * real Modals nesting confuses Chakra's modalManager/aria-hidden/scroll-lock machinery (see
 * `TaskAttachments.tsx`'s lightbox, which uses this identical Portal pattern for the same
 * reason — there it manifested as the outer modal auto-closing; here it manifested as the
 * INNER modal's own scroll container refusing to scroll, because a second scroll-lock on an
 * already-locked body over-blocks scroll instead of stacking cleanly). Since this is a plain
 * fixed-position overlay rather than a real Modal, none of Chakra's focus/scroll handling is
 * free — a lightweight Tab-cycling focus trap and Escape-to-close are implemented manually
 * below, mirroring the lightbox's approach. "Add Task" only stages the draft locally via
 * `onAdd` — nothing is sent to the API here; what happens with that draft (stage it for the
 * parent's own atomic create, or POST it immediately to an existing task) is entirely the
 * caller's decision. */
const SubtaskCreationModal: React.FC<SubtaskCreationModalProps> = ({
  isOpen,
  onClose,
  onAdd,
  defaultPriority = "P1",
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const developers = useAppSelector((state) => state.scheduler.developers);
  const currentUser = useAppSelector((state) => state.scheduler.currentUser);
  const toast = useToast();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [committedTitle, setCommittedTitle] = useState("");
  const [committedDescription, setCommittedDescription] = useState("");
  const [tags, setTags] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [durationHours, setDurationHours] = useState(0);
  const [durationMinutes, setDurationMinutes] = useState(0);
  const [priority, setPriority] = useState<Priority>(defaultPriority);
  const [status, setStatus] = useState<string>("todo");
  const [assigneeId, setAssigneeId] = useState("");
  const [isEod, setIsEod] = useState(false);
  const [stagedAttachments, setStagedAttachments] = useState<StagedAttachment[]>([]);

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
    setDescription("");
    setCommittedTitle("");
    setCommittedDescription("");
    setTags("");
    setDueDate("");
    setDurationHours(0);
    setDurationMinutes(0);
    setPriority(defaultPriority);
    setStatus("todo");
    setAssigneeId("");
    setIsEod(false);
    setStagedAttachments([]);
  }, [isOpen, defaultPriority]);

  // Plain Escape-to-close + a lightweight Tab-cycling focus trap — see the component docblock
  // for why this isn't a real Chakra <Modal> (and so gets none of that for free).
  useEffect(() => {
    if (!isOpen) return;
    lastFocusedRef.current = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        cardRef.current?.querySelectorAll<HTMLElement>(
          'input, textarea, select, button, [tabindex]:not([tabindex="-1"])',
        ) || [],
      ).filter((el) => !el.hasAttribute("disabled"));
    focusables()[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const els = focusables();
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      lastFocusedRef.current?.focus();
    };
  }, [isOpen, onClose]);

  const handleAdd = () => {
    if (!title.trim()) {
      toast({ title: "Title is required", status: "error" });
      return;
    }
    if (!assigneeId) {
      toast({
        title: "Assignee is required",
        description: "Please select who owns this subtask.",
        status: "error",
      });
      return;
    }
    const totalMinutes = Number(durationHours) * 60 + Number(durationMinutes);
    if (totalMinutes < 10) {
      toast({ title: "Duration must be at least 10 minutes.", status: "error" });
      return;
    }
    const finalDuration = `${String(durationHours).padStart(2, "0")}:${String(
      durationMinutes,
    ).padStart(2, "0")}`;

    onAdd({
      task_name: title.trim(),
      task_description: description || undefined,
      task_status: status,
      task_priority: priority,
      task_tags: tags || undefined,
      task_duration: finalDuration,
      task_due_date: dueDateToIso(dueDate),
      assigneeId,
      attachments: stagedAttachments.length ? stagedAttachments : undefined,
    });
    onClose();
  };

  const canInProgress =
    currentUser?.emp_designation?.toUpperCase() === "L1" || status === "in-progress";
  const canDone =
    currentUser?.emp_designation?.toUpperCase() === "L1" || status === "done";

  const STATUS_OPTIONS = [
    { value: "backlog", label: "Backlog", show: true },
    { value: "todo", label: "To Do", show: true },
    { value: "in-progress", label: "In Progress", show: canInProgress },
    { value: "done", label: "Done", show: canDone },
  ].filter((o) => o.show);

  if (!isOpen) return null;

  return (
    <Portal>
      <Box
        position="fixed"
        inset={0}
        zIndex="modal"
        bg="rgba(15,23,42,0.45)"
        backdropFilter="blur(12px)"
        display="flex"
        alignItems="center"
        justifyContent="center"
        p={4}
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label="Add Subtask"
      >
      <Box
        ref={cardRef}
        onClick={(e) => e.stopPropagation()}
        bg="white"
        borderRadius="1rem"
        boxShadow="0 32px 64px -12px rgba(0,0,0,0.14)"
        overflow="hidden"
        w="100%"
        maxW="5xl"
        h={{ base: "100vh", md: "85vh" }}
        maxH="85vh"
        display="flex"
        flexDirection="column"
      >
        <Flex justify="space-between" align="start" px={6} py={6} flexShrink={0}>
          <Box>
            <Text fontSize="2xl" fontWeight={700} letterSpacing="-0.01em" color="neutral.900">
              Add Subtask
            </Text>
            <Text fontSize="sm" color="neutral.500" mt={1}>
              Same details as a task — this one belongs to the story you're creating.
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

        <Box flex={1} minH={0} overflowY="auto" px={10} pb={10}>
          <Grid templateColumns={{ base: "1fr", lg: "2fr 1fr" }} gap={12}>
            <GridItem>
              <VStack spacing={10} align="stretch">
                <FormControl isRequired>
                  <FormLabel {...LABEL_PROPS}>Title</FormLabel>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onBlur={() => setCommittedTitle(title)}
                    placeholder="Subtask name..."
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
              </VStack>
            </GridItem>

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
                        onChange={(e) => setPriority(e.target.value as Priority)}
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
                          <NumberInputField {...cardFieldProps} px={3} py={2.5} />
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
                          <NumberInputField {...cardFieldProps} px={3} py={2.5} />
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
                    <TagsInput value={tags} onChange={setTags} addLabel="+ New" />
                  </FormControl>
                </VStack>
              </Box>
            </GridItem>
          </Grid>
        </Box>

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
            Cancel
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
            onClick={handleAdd}
          >
            Add Task
          </Button>
        </Flex>
      </Box>
      </Box>
    </Portal>
  );
};

export default SubtaskCreationModal;
