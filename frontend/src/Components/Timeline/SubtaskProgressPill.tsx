import React from "react";
import { Box, Text, Tooltip } from "@chakra-ui/react";
import { Task } from "types";

interface SubtaskProgressPillProps {
  task: Task;
  /**
   * "corner" absolutely-positions a tiny badge in the top-right of a `position: relative`/
   * `absolute` parent chip — used on the bigger Timeline segments, which have room to spare.
   * "inline" renders as a normal flex item next to the task name — used on the smaller
   * Week/Calendar/parked chips, which don't.
   */
  variant?: "corner" | "inline";
}

/**
 * Compact "done/total" progress indicator for a story chip (`task.subtask_total > 0`), shown
 * on Timeline/Week/Calendar chips (scale-gaps-plan.md §B.3). Deliberately NOT a full progress
 * bar — that was cut before at these views' density — this stays small enough not to disturb
 * the existing dense chip layouts. Renders nothing for a leaf task (`subtask_total` 0/unset).
 */
const SubtaskProgressPill: React.FC<SubtaskProgressPillProps> = ({ task, variant = "inline" }) => {
  const total = task.subtask_total || 0;
  if (total <= 0) return null;
  const done = task.subtask_done || 0;
  const complete = done >= total;

  const pill = (
    <Box
      as="span"
      display="inline-flex"
      alignItems="center"
      justifyContent="center"
      px="3px"
      h="12px"
      minW="16px"
      borderRadius="full"
      bg={complete ? "green.500" : "white"}
      border={complete ? "none" : "1px solid"}
      borderColor="neutral.300"
      boxShadow={variant === "corner" ? "0 1px 2px rgba(15,23,42,0.3)" : "none"}
      flexShrink={0}
      lineHeight={1}
    >
      <Text fontSize="7px" fontWeight={800} color={complete ? "white" : "neutral.700"} whiteSpace="nowrap">
        {done}/{total}
      </Text>
    </Box>
  );

  return (
    <Tooltip label={`${done}/${total} subtasks done`} openDelay={300} fontSize="xs">
      {variant === "corner" ? (
        <Box position="absolute" top="2px" right="2px" zIndex={3}>
          {pill}
        </Box>
      ) : (
        pill
      )}
    </Tooltip>
  );
};

export default SubtaskProgressPill;
