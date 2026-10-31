import { useMemo } from "react";
import { Box, Flex, Text, VisuallyHidden } from "@chakra-ui/react";
import { calculateSchedule } from "Utils/scheduler";
import { getPriorityHex } from "Utils/priority";
import { SampleDay } from "Utils/landingSample";
import { TaskBlock } from "types";

const START = 9;
const END = 19;
const HOURS = Array.from({ length: END - START + 1 }, (_, i) => START + i);

const pct = (h: number) => `${((Math.min(Math.max(h, START), END) - START) / (END - START)) * 100}%`;
const clock = (h: number) => {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh}:${String(mm).padStart(2, "0")}`;
};

/**
 * A read-only slice of the real timeline: the same `calculateSchedule` the app's Timeline
 * view runs (actual work sessions only), fed static sample data, drawn compactly.
 */
const MiniTimeline = ({ sample }: { sample: SampleDay }) => {
  const schedule = useMemo(
    () => calculateSchedule(sample.tasks, sample.developers, sample.config, sample.dayStart, { actualOnly: true }),
    [sample],
  );
  const tasksById = useMemo(() => new Map(sample.tasks.map((t) => [t.id, t])), [sample]);

  return (
    <Box role="figure" aria-label="Sample day on the Dayline timeline" w="full">
      <Flex mb={2} gap={3} h="16px" aria-hidden="true">
        <Box w={{ base: "72px", sm: "116px" }} flexShrink={0} />
        <Box position="relative" flex="1">
        {HOURS.map((h) => (
          <Text
            key={h}
            position="absolute"
            left={pct(h)}
            fontSize="10px"
            color="neutral.500"
            display={{ base: h % 2 ? "none" : "block", sm: "block" }}
            transform="translateX(-50%)"
          >
            {h}
          </Text>
        ))}
        </Box>
      </Flex>
      {sample.developers.map((dev) => {
        const blocks = (schedule[dev.emp_id] || []).filter((b: TaskBlock) => b.date === sample.dateKey);
        return (
          <Flex key={dev.emp_id} align="center" gap={3} py={1.5}>
            <Text w={{ base: "72px", sm: "116px" }} flexShrink={0} fontSize="xs" fontWeight={600} color="neutral.700" noOfLines={1}>
              <Box as="span" display={{ base: "inline", sm: "none" }}>{dev.emp_name.split(" ")[0]}</Box>
              <Box as="span" display={{ base: "none", sm: "inline" }}>{dev.emp_name}</Box>
            </Text>
            <Box as="ul" listStyleType="none" position="relative" flex="1" h="26px" bg="neutral.50" borderRadius="md" borderWidth="1px" borderColor="neutral.100">
              {blocks.map((b: TaskBlock, i: number) => {
                const task = tasksById.get(b.taskId);
                const color = getPriorityHex(task?.task_priority);
                const held = task?.task_status === "on-hold";
                const label = `${task?.task_name}, ${clock(b.startTime)} to ${clock(b.endTime)}`;
                return (
                  <Box
                    as="li"
                    key={`${b.taskId}-${i}`}
                    aria-label={label}
                    title={label}
                    position="absolute"
                    top="3px"
                    bottom="3px"
                    left={pct(b.startTime)}
                    w={`calc(${pct(b.endTime)} - ${pct(b.startTime)})`}
                    borderRadius="sm"
                    bg={held ? "white" : color}
                    borderWidth={held ? "2px" : 0}
                    borderStyle="dashed"
                    borderColor={color}
                    opacity={task?.task_status === "done" ? 0.75 : 1}
                  >
                    <VisuallyHidden>{label}</VisuallyHidden>
                  </Box>
                );
              })}
            </Box>
          </Flex>
        );
      })}
    </Box>
  );
};

export default MiniTimeline;
