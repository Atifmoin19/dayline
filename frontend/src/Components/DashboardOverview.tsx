import React, { useMemo } from "react";
import {
  Box,
  Flex,
  Text,
  SimpleGrid,
  Button,
  Icon,
  HStack,
  Progress,
} from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";
import {
  FaClock,
  FaTasks,
  FaCheck,
  FaHistory,
  FaUsers,
  FaBolt,
  FaPlus,
  FaSitemap,
  FaExclamationCircle,
} from "Utils/icons";
import { Task, Employee } from "types";
import { formatDuration } from "Utils/common";
import { HERO_BRAND_GRADIENT, STAT_GRADIENTS } from "Styles";
import type { IconType } from "react-icons";

interface Props {
  currentUser: Employee;
  tasks: Task[];
  developers: Employee[];
  isManagement: boolean;
  onCreateTask: () => void;
}

const lc = (s?: string) => (s || "").toLowerCase();
const isDone = (t: Task) => ["done", "completed"].includes(lc(t.task_status));
const isActive = (t: Task) => ["in-progress", "in progress"].includes(lc(t.task_status));
const isPending = (t: Task) => ["todo", "backlog", "on-hold", "on hold"].includes(lc(t.task_status));

const StatTile: React.FC<{
  icon: IconType;
  label: string;
  value: React.ReactNode;
  gradient: string;
  accent: string;
}> = ({ icon, label, value, gradient, accent }) => (
  <Box
    bgGradient={gradient}
    border="1px solid"
    borderColor="surface.border"
    borderRadius="card"
    p={4}
    position="relative"
    overflow="hidden"
    transition="transform 0.14s, box-shadow 0.14s"
    _hover={{ transform: "translateY(-2px)", boxShadow: "cardHover" }}
  >
    <Flex
      w="38px"
      h="38px"
      borderRadius="0.7rem"
      align="center"
      justify="center"
      bg="white"
      color={accent}
      boxShadow="card"
      mb={3}
    >
      <Icon as={icon} boxSize={4} />
    </Flex>
    <Text fontSize="2xl" fontWeight={800} color="neutral.900" lineHeight="1">
      {value}
    </Text>
    <Text fontSize="xs" color="neutral.600" mt={1} fontWeight={600} textTransform="uppercase" letterSpacing="0.04em">
      {label}
    </Text>
  </Box>
);

const DashboardOverview: React.FC<Props> = ({
  currentUser,
  tasks,
  developers,
  isManagement,
  onCreateTask,
}) => {
  const navigate = useNavigate();

  const s = useMemo(() => {
    const scope = isManagement
      ? tasks
      : tasks.filter((t) => t.task_assigned_to === currentUser.emp_id);
    const now = Date.now();
    const inProgress = scope.filter(isActive).length;
    const pending = scope.filter(isPending).length;
    const completed = scope.filter(isDone).length;
    const total = scope.length || 1;
    const hours = scope.reduce((sum, t) => sum + (Number(t.time_spent) || 0), 0);
    const activeNow = new Set(scope.filter(isActive).map((t) => t.task_assigned_to)).size;
    const overdue = scope.filter(
      (t) => !isDone(t) && t.task_due_date && new Date(t.task_due_date).getTime() < now,
    ).length;
    const completionPct = Math.round((completed / total) * 100);
    return { inProgress, pending, completed, hours, activeNow, overdue, completionPct, teamSize: developers.length };
  }, [tasks, developers, currentUser, isManagement]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = (currentUser.emp_name || "there").split(" ")[0];
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const tiles = isManagement
    ? [
        { icon: FaBolt, label: "Active now", value: s.activeNow, g: STAT_GRADIENTS.blue, a: "brand.600" },
        { icon: FaClock, label: "In progress", value: s.inProgress, g: STAT_GRADIENTS.indigo, a: "blue.500" },
        { icon: FaTasks, label: "Pending", value: s.pending, g: STAT_GRADIENTS.amber, a: "orange.500" },
        { icon: FaExclamationCircle, label: "Overdue", value: s.overdue, g: STAT_GRADIENTS.rose, a: "red.500" },
        { icon: FaCheck, label: "Completed", value: s.completed, g: STAT_GRADIENTS.emerald, a: "green.600" },
        { icon: FaUsers, label: "Team members", value: s.teamSize, g: STAT_GRADIENTS.violet, a: "purple.500" },
      ]
    : [
        { icon: FaClock, label: "In progress", value: s.inProgress, g: STAT_GRADIENTS.blue, a: "brand.600" },
        { icon: FaTasks, label: "Pending", value: s.pending, g: STAT_GRADIENTS.amber, a: "orange.500" },
        { icon: FaCheck, label: "Completed", value: s.completed, g: STAT_GRADIENTS.emerald, a: "green.600" },
        { icon: FaHistory, label: "Time logged", value: formatDuration(s.hours), g: STAT_GRADIENTS.violet, a: "purple.500" },
      ];

  return (
    <Box mb={6}>
      {/* Gradient hero */}
      <Box
        bgGradient={HERO_BRAND_GRADIENT}
        borderRadius="card"
        p={{ base: 6, md: 7 }}
        color="white"
        position="relative"
        overflow="hidden"
        boxShadow="cardHover"
        mb={5}
      >
        {/* soft decorative blobs */}
        <Box position="absolute" top="-40px" right="-30px" w="180px" h="180px" bg="whiteAlpha.200" borderRadius="full" filter="blur(6px)" />
        <Box position="absolute" bottom="-60px" right="120px" w="140px" h="140px" bg="whiteAlpha.100" borderRadius="full" />

        <Flex justify="space-between" align={{ base: "start", md: "center" }} direction={{ base: "column", md: "row" }} gap={4} position="relative">
          <Box>
            <Text fontSize="xs" fontWeight={600} color="whiteAlpha.800" textTransform="uppercase" letterSpacing="0.08em">
              {today}
            </Text>
            <Text fontSize="2xl" fontWeight={800} mt={1} lineHeight="1.1" color="white">
              {greeting}, {firstName}
            </Text>
            <Text fontSize="sm" color="whiteAlpha.900" mt={2} maxW="520px">
              {isManagement
                ? `Your team has ${s.inProgress} task${s.inProgress === 1 ? "" : "s"} in progress and ${s.pending} waiting to be picked up.`
                : s.inProgress > 0
                ? `You're working on ${s.inProgress} task${s.inProgress === 1 ? "" : "s"}. Keep it up!`
                : s.pending > 0
                ? `You have ${s.pending} task${s.pending === 1 ? "" : "s"} waiting. Pick one to get started.`
                : "You're all caught up. Nothing pending right now."}
            </Text>
            <HStack mt={5} spacing={3}>
              <Button
                leftIcon={<FaPlus />}
                bg="white"
                color="brand.700"
                _hover={{ bg: "whiteAlpha.900" }}
                size="sm"
                onClick={onCreateTask}
              >
                Create Task
              </Button>
              <Button
                leftIcon={<FaSitemap />}
                variant="outline"
                color="white"
                borderColor="whiteAlpha.500"
                _hover={{ bg: "whiteAlpha.200" }}
                size="sm"
                onClick={() => navigate("/organization")}
              >
                Organization
              </Button>
            </HStack>
          </Box>

          {/* Completion ring-ish summary */}
          <Box bg="whiteAlpha.200" borderRadius="card" p={4} minW="180px" backdropFilter="blur(6px)">
            <Text fontSize="xs" color="whiteAlpha.800" textTransform="uppercase" letterSpacing="0.06em" fontWeight={600}>
              {isManagement ? "Team completion" : "Your completion"}
            </Text>
            <Text fontSize="2xl" fontWeight={800} mt={1} color="white">
              {s.completionPct}%
            </Text>
            <Progress
              value={s.completionPct}
              size="sm"
              mt={2}
              borderRadius="full"
              bg="whiteAlpha.300"
              sx={{ "& > div": { background: "white" } }}
            />
            <Text fontSize="xs" color="whiteAlpha.800" mt={2}>
              {s.completed} done · {s.inProgress + s.pending} open
            </Text>
          </Box>
        </Flex>
      </Box>

      {/* KPI tiles */}
      <SimpleGrid columns={{ base: 2, md: 3, xl: isManagement ? 6 : 4 }} spacing={4}>
        {tiles.map((t) => (
          <StatTile key={t.label} icon={t.icon} label={t.label} value={t.value} gradient={t.g} accent={t.a} />
        ))}
      </SimpleGrid>
    </Box>
  );
};

export default DashboardOverview;
