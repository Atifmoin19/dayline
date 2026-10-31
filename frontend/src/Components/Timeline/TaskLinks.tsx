import React from "react";
import {
  Box,
  Flex,
  Text,
  Badge,
  Select,
  HStack,
  IconButton,
  Spinner,
  useToast,
} from "@chakra-ui/react";
import { FaTrash, FaPlus } from "Utils/icons";
import { cardFieldProps } from "Components/Timeline/taskModalStyles";
import {
  useTaskLinksQuery,
  useAddTaskLinkMutation,
  useDeleteTaskLinkMutation,
} from "Services/user.api";
import { useAppSelector } from "app/hooks";
import { getPriorityColor } from "Utils/priority";
import { TaskLink } from "types";
import { getApiErrorMessage } from "Services/baseQuery";

const LINK_BADGE: Record<string, { label: string; colorScheme: string }> = {
  dependsOn: { label: "Depends on", colorScheme: "gray" },
  dependents: { label: "Blocks", colorScheme: "red" },
  parents: { label: "Parent", colorScheme: "purple" },
  subtasks: { label: "Subtask", colorScheme: "blue" },
};

const LinkRow: React.FC<{ l: TaskLink; kind: string; onRemove: (id: number) => void }> = ({
  l,
  kind,
  onRemove,
}) => {
  const isDone = ["done", "completed"].includes((l.task_status || "").toLowerCase());
  const badge = LINK_BADGE[kind];
  return (
    <Flex
      align="center"
      gap={2}
      py={2}
      px={3}
      mb={1.5}
      bg="neutral.50"
      border="1px solid"
      borderColor="surface.border"
      borderRadius="md"
    >
      <Badge colorScheme={badge.colorScheme} borderRadius="pill" px={2} flexShrink={0}>
        {badge.label}
      </Badge>
      {l.task_priority && (
        <Badge colorScheme={getPriorityColor(l.task_priority)} fontSize="0.6rem">
          {l.task_priority}
        </Badge>
      )}
      <Text
        fontSize="sm"
        color={isDone ? "neutral.500" : "neutral.700"}
        textDecoration={isDone ? "line-through" : undefined}
        isTruncated
        flex={1}
      >
        {l.task_name || l.task_id}
      </Text>
      <IconButton
        aria-label="Remove link"
        icon={<FaTrash />}
        size="xs"
        variant="ghost"
        colorScheme="red"
        onClick={() => onRemove(l.link_id)}
      />
    </Flex>
  );
};

const Group: React.FC<{ kind: string; links: TaskLink[]; onRemove: (id: number) => void }> = ({
  kind,
  links,
  onRemove,
}) =>
  links.length === 0 ? null : (
    <Box mb={1}>
      {links.map((l) => (
        <LinkRow key={l.link_id} l={l} kind={kind} onRemove={onRemove} />
      ))}
    </Box>
  );

const TaskLinks: React.FC<{ taskId: string }> = ({ taskId }) => {
  const toast = useToast();
  const { tasks } = useAppSelector((state) => state.scheduler);
  const { data: links = [], isLoading } = useTaskLinksQuery(taskId, {
    skip: !taskId,
  });
  const [addLink, { isLoading: adding }] = useAddTaskLinkMutation();
  const [deleteLink] = useDeleteTaskLinkMutation();

  const [kind, setKind] = React.useState("depends_on"); // depends_on | subtask-child | parent
  const [target, setTarget] = React.useState("");
  const [showAdder, setShowAdder] = React.useState(false);

  const linkedIds = new Set(links.map((l) => l.task_id));
  const options = tasks.filter((t) => t.id !== taskId && !linkedIds.has(t.id));

  // Grouping by semantics (see backend edge definition). Subtask/parent edges are deliberately
  // NOT grouped/rendered here — they get a richer clickable treatment (ticket id, progress,
  // assignee) in TaskDetailForm's own "Subtasks" section and parent breadcrumb; this component
  // stays true dependencies only, matching its "Links & Dependencies" heading. The `kind`
  // selector below still supports linking subtask/parent (an already-existing task) — that
  // result just surfaces in TaskDetailForm's section instead of appearing a second time here.
  const dependsOn = links.filter((l) => l.link_type === "depends_on" && l.direction === "outgoing");
  const dependents = links.filter((l) => l.link_type === "depends_on" && l.direction === "incoming");

  const remove = async (linkId: number) => {
    try {
      await deleteLink({ linkId, taskId }).unwrap();
    } catch {
      toast({ title: "Failed to remove link", status: "error" });
    }
  };

  const add = async () => {
    if (!target) return;
    try {
      if (kind === "subtask-child") {
        // Child → parent edge: this task is the parent, `target` the child.
        await addLink({ taskId: target, to_task_id: taskId, link_type: "subtask" }).unwrap();
      } else if (kind === "parent") {
        // This task is a subtask of `target`.
        await addLink({ taskId, to_task_id: target, link_type: "subtask" }).unwrap();
      } else {
        await addLink({ taskId, to_task_id: target, link_type: "depends_on" }).unwrap();
      }
      setTarget("");
      setShowAdder(false);
    } catch (e) {
      toast({
        title: "Failed to add link",
        description: getApiErrorMessage(e),
        status: "error",
      });
    }
  };

  return (
    <Box>
      {isLoading ? (
        <Flex justify="center" py={3}>
          <Spinner size="sm" />
        </Flex>
      ) : (
        <>
          <Group kind="dependsOn" links={dependsOn} onRemove={remove} />
          <Group kind="dependents" links={dependents} onRemove={remove} />
        </>
      )}

      {showAdder ? (
        <HStack mt={2} spacing={2}>
          <Select
            size="sm"
            maxW="130px"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            px={2}
            {...cardFieldProps}
          >
            <option value="depends_on">Depends on</option>
            <option value="subtask-child">Add subtask</option>
            <option value="parent">Set parent</option>
          </Select>
          <Select
            size="sm"
            flex={1}
            placeholder="Select task…"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            px={2}
            {...cardFieldProps}
          >
            {options.map((t) => (
              <option key={t.id} value={t.id}>
                {t.task_name}
              </option>
            ))}
          </Select>
          <IconButton
            aria-label="Confirm link"
            icon={<FaPlus />}
            size="sm"
            colorScheme="brand"
            borderRadius="0.75rem"
            onClick={add}
            isLoading={adding}
            isDisabled={!target}
            flexShrink={0}
          />
        </HStack>
      ) : (
        <Box
          as="button"
          type="button"
          onClick={() => setShowAdder(true)}
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
    </Box>
  );
};

export default TaskLinks;
