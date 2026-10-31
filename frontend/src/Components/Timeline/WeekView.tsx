import React, { useMemo, useState } from "react";
import {
  Box,
  Flex,
  Text,
  HStack,
  IconButton,
  Button,
  Tooltip,
} from "@chakra-ui/react";
import { FaChevronLeft, FaChevronRight } from "Utils/icons";
import { useAppSelector } from "app/hooks";
import { getLocalDateKey } from "Utils/scheduler";
import { getPriorityHex } from "Utils/priority";
import { taskColor } from "Utils/avatar";
import UserAvatar from "Components/UserAvatar";
import { Task, Employee } from "types";
import { getVisibleScope } from "Utils/orgTree";
import SubtaskProgressPill from "Components/Timeline/SubtaskProgressPill";
import MemberSearchFilter from "Components/Timeline/MemberSearchFilter";
import SavedTeamViewsPopover from "Components/Timeline/SavedTeamViewsPopover";

interface WeekViewProps {
  onEditTask: (task: Task) => void;
  filteredManagerId?: string;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// A nominal working day (hours) used to scale the per-day worked-time bar.
const WORKDAY_HOURS = 8;

const mmss = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
};

/** Worked minutes of a session (open sessions count up to now). */
const sessionMins = (s: { start_time?: string; end_time?: string }): number => {
  if (!s.start_time) return 0;
  const start = new Date(s.start_time).getTime();
  if (isNaN(start)) return 0;
  const end = s.end_time ? new Date(s.end_time).getTime() : Date.now();
  return Math.max(0, Math.round((end - start) / 60000));
};

const WeekView: React.FC<WeekViewProps> = ({ onEditTask, filteredManagerId }) => {
  const { developers: allDevelopers, tasks, currentUser } = useAppSelector(
    (state) => state.scheduler,
  );

  // Same org-tree scoping as the timeline: self + recursive subtree.
  const scopedDevelopers = useMemo<Employee[]>(() => {
    if (!currentUser) return [];
    const visible = getVisibleScope(allDevelopers, currentUser, filteredManagerId);
    return allDevelopers.filter((d) => visible.has(d.emp_id));
  }, [allDevelopers, currentUser, filteredManagerId]);

  // Member search-filter (scale-gaps-plan.md §B.1) — narrows the org-tree-scoped set above
  // down to a hand-picked (possibly cross-functional) group of people. Empty selection = show
  // the full org-tree-scoped set, unchanged.
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const developers = useMemo<Employee[]>(() => {
    if (selectedMemberIds.length === 0) return scopedDevelopers;
    const selectedSet = new Set(selectedMemberIds);
    return scopedDevelopers.filter((d) => selectedSet.has(d.emp_id));
  }, [scopedDevelopers, selectedMemberIds]);

  // Monday of the currently-viewed week (offset in whole weeks from this week).
  const [weekOffset, setWeekOffset] = useState(0);
  const weekDays = useMemo(() => {
    const now = new Date();
    const dow = (now.getDay() + 6) % 7; // 0 = Monday
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      return { date: d, key: getLocalDateKey(d) };
    });
  }, [weekOffset]);

  const todayKey = getLocalDateKey(new Date());
  const dayKeySet = useMemo(() => new Set(weekDays.map((d) => d.key)), [weekDays]);

  // worked[empId][dayKey] = { total, byTask: {taskId: {task, mins}} }
  const worked = useMemo(() => {
    const map: Record<string, Record<string, { total: number; byTask: Record<string, { task: Task; mins: number }> }>> = {};
    for (const t of tasks) {
      const who = t.task_assigned_to;
      if (!who) continue;
      for (const s of t.task_sessions || []) {
        if (!s.start_time) continue;
        const key = getLocalDateKey(new Date(s.start_time));
        if (!dayKeySet.has(key)) continue;
        const mins = sessionMins(s);
        if (mins <= 0) continue;
        const perUser = (map[who] ||= {});
        const cell = (perUser[key] ||= { total: 0, byTask: {} });
        cell.total += mins;
        const bt = (cell.byTask[t.id] ||= { task: t, mins: 0 });
        bt.mins += mins;
      }
    }
    return map;
  }, [tasks, dayKeySet]);

  const rangeLabel = `${weekDays[0].date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${weekDays[6].date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;

  const gridCols = "180px repeat(7, 1fr)";

  return (
    <Box bg="white" border="1px solid" borderColor="surface.border" borderRadius="14px" p={4}>
      {/* Header */}
      <Flex justify="space-between" align="center" mb={4} wrap="wrap" gap={2}>
        <HStack spacing={3}>
          <Text fontSize="lg" fontWeight={800} color="neutral.900">
            {rangeLabel}
          </Text>
          <Button size="xs" variant="outline" onClick={() => setWeekOffset(0)} borderRadius="8px">
            This week
          </Button>
        </HStack>
        <HStack spacing={1}>
          <IconButton aria-label="Previous week" icon={<FaChevronLeft />} size="sm" variant="ghost" onClick={() => setWeekOffset((w) => w - 1)} />
          <IconButton aria-label="Next week" icon={<FaChevronRight />} size="sm" variant="ghost" onClick={() => setWeekOffset((w) => w + 1)} />
        </HStack>
      </Flex>

      {/* Member search-filter + saved team views (scale-gaps-plan.md §B.1/§B.2) */}
      <Flex justify="space-between" align="center" mb={3} wrap="wrap" gap={3}>
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

      <Box overflowX="auto">
        <Box minW="720px">
          {/* Day header row */}
          <Box display="grid" gridTemplateColumns={gridCols} borderBottom="1px solid" borderColor="surface.border">
            <Box />
            {weekDays.map((d, di) => (
              <Box key={d.key} textAlign="center" py={2} bg={d.key === todayKey ? "brand.50" : "transparent"}>
                <Text fontSize="xs" fontWeight={700} color="neutral.500" textTransform="uppercase">
                  {DAY_LABELS[di]}
                </Text>
                <Text fontSize="sm" fontWeight={d.key === todayKey ? 800 : 600} color={d.key === todayKey ? "brand.700" : "neutral.700"}>
                  {d.date.getDate()}
                </Text>
              </Box>
            ))}
          </Box>

          {/* One row per user */}
          {developers.length === 0 && (
            <Text py={6} textAlign="center" color="neutral.500" fontSize="sm">
              No team members to show.
            </Text>
          )}
          {developers.map((dev) => (
            <Box
              key={dev.emp_id}
              display="grid"
              gridTemplateColumns={gridCols}
              borderBottom="1px solid"
              borderColor="surface.border"
              _last={{ borderBottom: "none" }}
            >
              {/* User cell */}
              <Flex align="center" gap={2} py={2} pr={2}>
                <UserAvatar size="xs" name={dev.emp_name} photo={dev.profile_pic} />
                <Box minW={0}>
                  <Text fontSize="xs" fontWeight={700} color="neutral.800" noOfLines={1}>
                    {dev.emp_name}
                  </Text>
                  <Text fontSize="10px" color="neutral.500" noOfLines={1}>
                    {dev.emp_designation}
                  </Text>
                </Box>
              </Flex>

              {/* 7 day cells */}
              {weekDays.map((d) => {
                const cell = worked[dev.emp_id]?.[d.key];
                const total = cell?.total || 0;
                const pct = Math.min(100, (total / (WORKDAY_HOURS * 60)) * 100);
                const chips = cell ? Object.values(cell.byTask).sort((a, b) => b.mins - a.mins) : [];
                return (
                  <Box
                    key={d.key}
                    borderLeft="1px solid"
                    borderColor="surface.border"
                    p={1.5}
                    minH="72px"
                    bg={d.key === todayKey ? "brand.50" : "white"}
                  >
                    {total > 0 ? (
                      <>
                        {/* worked-time bar */}
                        <Tooltip label={`${mmss(total)} worked`} openDelay={300} fontSize="xs">
                          <Box mb={1}>
                            <Box h="4px" bg="neutral.100" borderRadius="full" overflow="hidden">
                              <Box h="100%" w={`${pct}%`} bg="brand.500" borderRadius="full" />
                            </Box>
                            <Text fontSize="10px" color="neutral.500" mt="2px" fontWeight={600}>
                              {mmss(total)}
                            </Text>
                          </Box>
                        </Tooltip>
                        {chips.slice(0, 2).map(({ task, mins }) => (
                          <Tooltip key={task.id} label={`${task.task_name} · ${mmss(mins)}`} openDelay={300} fontSize="xs">
                            <Box
                              onClick={() => onEditTask(task)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  onEditTask(task);
                                }
                              }}
                              role="button"
                              tabIndex={0}
                              aria-label={task.task_name}
                              cursor="pointer"
                              mb="2px"
                              px={1}
                              py="1px"
                              borderRadius="4px"
                              borderLeft="2px solid"
                              borderLeftColor={getPriorityHex(task.task_priority)}
                              bg={`${taskColor(task.id)}22`}
                              _hover={{ bg: `${taskColor(task.id)}33` }}
                              _focusVisible={{ outline: "2px solid", outlineColor: "blue.400", outlineOffset: "1px" }}
                            >
                              <Flex align="center" gap={1}>
                                <Text fontSize="10px" fontWeight={600} color="neutral.800" noOfLines={1} flex={1} minW={0}>
                                  {task.task_name}
                                </Text>
                                <SubtaskProgressPill task={task} variant="inline" />
                              </Flex>
                            </Box>
                          </Tooltip>
                        ))}
                        {chips.length > 2 && (
                          <Text fontSize="10px" color="neutral.500" fontWeight={600}>
                            +{chips.length - 2} more
                          </Text>
                        )}
                      </>
                    ) : (
                      <Text fontSize="10px" color="neutral.300" textAlign="center" mt={4}>
                        —
                      </Text>
                    )}
                  </Box>
                );
              })}
            </Box>
          ))}
        </Box>
      </Box>

      <Text mt={3} fontSize="xs" color="neutral.500">
        Worked time per day from real sessions. Click a task to open it. Bar scales to a {WORKDAY_HOURS}h day.
      </Text>
    </Box>
  );
};

export default WeekView;
