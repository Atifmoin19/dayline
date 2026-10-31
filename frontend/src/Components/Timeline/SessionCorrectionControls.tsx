import React, { useState } from "react";
import {
  Flex,
  Box,
  Text,
  Input,
  IconButton,
  Button,
  HStack,
  useToast,
} from "@chakra-ui/react";
import { FaTrash, FaEdit, FaCut, FaCheck, FaTimes } from "Utils/icons";
import { useAppDispatch } from "app/hooks";
import { updateTask } from "app/slices/scheduler.slice";
import {
  useDeleteTaskSessionMutation,
  useEditTaskSessionMutation,
  useSplitTaskSessionMutation,
} from "Services/user.api";
import { Task, TaskSession } from "types";

interface Props {
  task: Task;
  session: TaskSession;
  fmtClock: (iso?: string) => string;
  statusDotColor: (status?: string) => string;
}

/** "HH:MM" in the viewer's local time for an ISO instant (used to seed the time inputs). */
const toTimeValue = (iso?: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** Apply an "HH:MM" onto the same calendar day as `baseIso`, returning a new ISO instant. */
const withTime = (baseIso: string | undefined, hhmm: string): string | null => {
  if (!hhmm) return null;
  const base = baseIso ? new Date(baseIso) : new Date();
  if (isNaN(base.getTime())) return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

/**
 * Per-session row with manual time-correction controls: edit (adjust start/end),
 * split (break one session in two), and delete. Holds its own small UI state so the
 * timeline popover stays clean. Mutations invalidate the Task cache; we also optimistically
 * dispatch the returned task into redux for an instant refresh.
 */
const SessionCorrectionControls: React.FC<Props> = ({
  task,
  session,
  fmtClock,
  statusDotColor,
}) => {
  const dispatch = useAppDispatch();
  const toast = useToast();
  const [deleteSession] = useDeleteTaskSessionMutation();
  const [editSession, { isLoading: editing }] = useEditTaskSessionMutation();
  const [splitSession, { isLoading: splitting }] = useSplitTaskSessionMutation();

  const [mode, setMode] = useState<"view" | "edit" | "split">("view");
  const [startVal, setStartVal] = useState(toTimeValue(session.start_time));
  const [endVal, setEndVal] = useState(toTimeValue(session.end_time));
  const [splitVal, setSplitVal] = useState("");

  const live = !session.end_time;
  const mins =
    session.start_time && session.end_time
      ? Math.max(
          0,
          Math.round(
            (new Date(session.end_time).getTime() -
              new Date(session.start_time).getTime()) /
              60000,
          ),
        )
      : null;

  const apply = (resp: Task | undefined, fallbackTitle: string) => {
    if (resp) dispatch(updateTask(resp));
    toast({ title: fallbackTitle, status: "success", duration: 1800 });
    setMode("view");
  };

  const onEditSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const newStart = withTime(session.start_time, startVal);
    const newEnd = live ? undefined : withTime(session.end_time, endVal) || undefined;
    try {
      const resp = await editSession({
        id: task.id,
        start_time: session.start_time,
        ...(newStart ? { new_start_time: newStart } : {}),
        ...(newEnd ? { new_end_time: newEnd } : {}),
      }).unwrap();
      apply(resp, "Session updated");
    } catch {
      toast({ title: "Couldn't update session", status: "error", duration: 3000 });
    }
  };

  const onSplitSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const at = withTime(session.start_time, splitVal);
    if (!at) {
      toast({ title: "Pick a split time", status: "warning", duration: 2000 });
      return;
    }
    try {
      const resp = await splitSession({
        id: task.id,
        start_time: session.start_time,
        split_at: at,
      }).unwrap();
      apply(resp, "Session split");
    } catch {
      toast({ title: "Split must be inside the session", status: "error", duration: 3000 });
    }
  };

  const onDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const resp = await deleteSession({ id: task.id, start_time: session.start_time }).unwrap();
      if (resp) dispatch(updateTask(resp));
      toast({ title: "Session removed", status: "success", duration: 1800 });
    } catch {
      toast({ title: "Failed to remove session", status: "error", duration: 3000 });
    }
  };

  return (
    <Box>
      <Flex align="center" gap={2} fontSize="xs" onClick={(e) => e.stopPropagation()}>
        <Box
          w="6px"
          h="6px"
          borderRadius="full"
          bg={live ? "green.400" : statusDotColor(session.status)}
          flexShrink={0}
        />
        <Text color="neutral.700">
          {fmtClock(session.start_time)} – {live ? "now" : fmtClock(session.end_time)}
        </Text>
        <Text color="neutral.500">
          {live ? "active" : session.status || "worked"}
          {mins !== null ? ` · ${mins}m` : ""}
        </Text>
        {!live && (
          <HStack spacing={0.5} ml="auto">
            <IconButton
              aria-label="Edit session"
              icon={<FaEdit />}
              size="xs"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                setStartVal(toTimeValue(session.start_time));
                setEndVal(toTimeValue(session.end_time));
                setMode(mode === "edit" ? "view" : "edit");
              }}
            />
            <IconButton
              aria-label="Split session"
              icon={<FaCut />}
              size="xs"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                setSplitVal("");
                setMode(mode === "split" ? "view" : "split");
              }}
            />
            <IconButton
              aria-label="Remove session"
              icon={<FaTrash />}
              size="xs"
              variant="ghost"
              colorScheme="red"
              onClick={onDelete}
            />
          </HStack>
        )}
      </Flex>

      {mode === "edit" && (
        <HStack mt={1} mb={1} spacing={2} onClick={(e) => e.stopPropagation()}>
          <Input
            type="time"
            size="xs"
            w="90px"
            value={startVal}
            onChange={(e) => setStartVal(e.target.value)}
          />
          <Text fontSize="xs" color="neutral.500">
            –
          </Text>
          <Input
            type="time"
            size="xs"
            w="90px"
            value={endVal}
            onChange={(e) => setEndVal(e.target.value)}
          />
          <IconButton
            aria-label="Save"
            icon={<FaCheck />}
            size="xs"
            colorScheme="brand"
            isLoading={editing}
            onClick={onEditSave}
          />
          <IconButton
            aria-label="Cancel"
            icon={<FaTimes />}
            size="xs"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              setMode("view");
            }}
          />
        </HStack>
      )}

      {mode === "split" && (
        <HStack mt={1} mb={1} spacing={2} onClick={(e) => e.stopPropagation()}>
          <Text fontSize="xs" color="neutral.500">
            Split at
          </Text>
          <Input
            type="time"
            size="xs"
            w="90px"
            value={splitVal}
            onChange={(e) => setSplitVal(e.target.value)}
          />
          <Button size="xs" colorScheme="brand" isLoading={splitting} onClick={onSplitSave}>
            Split
          </Button>
          <IconButton
            aria-label="Cancel"
            icon={<FaTimes />}
            size="xs"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              setMode("view");
            }}
          />
        </HStack>
      )}
    </Box>
  );
};

export default SessionCorrectionControls;
