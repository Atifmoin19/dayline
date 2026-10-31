import React from "react";
import {
  Box,
  Container,
  Flex,
  Heading,
  Text,
  SimpleGrid,
  HStack,
  VStack,
  Avatar,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
} from "@chakra-ui/react";
import { Link } from "react-router-dom";
import SimpleLayout from "Layouts/simpleLayout";
import { useAppSelector } from "app/hooks";
import {
  useTaskListQuery,
  useUserListQuery,
  useSprintListQuery,
} from "Services/user.api";
import { Task, Employee } from "types";
import { avatarColor } from "Utils/avatar";
import { getPriorityHex } from "Utils/priority";
import { formatDuration } from "Utils/common";
import { getLocalDateKey } from "Utils/scheduler";
import { APP_HOME } from "Utils/constants";

const STATUS_COLORS: Record<string, string> = {
  "in-progress": "#2563eb",
  todo: "#94a3b8",
  "on-hold": "#eab308",
  backlog: "#f97316",
  done: "#16a34a",
  completed: "#16a34a",
};

const StatCard: React.FC<{ label: string; value: string | number; color?: string }> = ({
  label,
  value,
  color = "neutral.900",
}) => (
  <Box
    bg="surface.card"
    border="1px solid"
    borderColor="surface.border"
    borderRadius="card"
    boxShadow="card"
    p={5}
  >
    <Text fontSize="2xl" fontWeight={700} color={color} lineHeight="1.1">
      {value}
    </Text>
    <Text
      fontSize="xs"
      color="neutral.500"
      mt={1}
      textTransform="uppercase"
      letterSpacing="0.04em"
    >
      {label}
    </Text>
  </Box>
);

const Panel: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <Box
    bg="surface.card"
    border="1px solid"
    borderColor="surface.border"
    borderRadius="card"
    boxShadow="card"
    p={5}
  >
    <Text
      fontSize="sm"
      fontWeight={700}
      color="neutral.500"
      textTransform="uppercase"
      letterSpacing="0.04em"
      mb={4}
    >
      {title}
    </Text>
    {children}
  </Box>
);

const norm = (s?: string) => (s || "").toLowerCase();

const ReportsPage: React.FC = () => {
  const { currentUser, developers: sliceDevs } = useAppSelector(
    (state) => state.scheduler,
  );

  // Team-wide (server scopes to the caller's hierarchy). Local — not written to the slice.
  const { data: taskData } = useTaskListQuery(
    {},
    { refetchOnMountOrArgChange: true, skip: !currentUser },
  );
  const { data: userData } = useUserListQuery(undefined, { skip: !currentUser });
  // Company-wide, not org-tree scoped (same as Epics) — see Sprint in types.ts.
  const { data: sprintData = [] } = useSprintListQuery(undefined, { skip: !currentUser });

  const tasks: Task[] = React.useMemo(() => {
    if (!taskData) return [];
    return Array.isArray(taskData) ? taskData : taskData.items ?? [];
  }, [taskData]);

  const developers: Employee[] = (userData as Employee[]) || sliceDevs || [];
  const devName = (id?: string) =>
    developers.find((d) => d.emp_id === id)?.emp_name || id || "Unassigned";

  const total = tasks.length;
  const by = (statuses: string[]) =>
    tasks.filter((t) => statuses.includes(norm(t.task_status))).length;
  const inProgress = by(["in-progress", "in progress"]);
  const done = by(["done", "completed"]);
  const overdue = by(["backlog"]);
  const onHold = by(["on-hold"]);
  const todo = by(["todo"]);
  const completionRate = total ? Math.round((done / total) * 100) : 0;
  const totalLogged = tasks.reduce(
    (s, t) => s + (Number(t.time_spent) || 0),
    0,
  );

  // Status distribution
  const statusRows = [
    { key: "in-progress", label: "In Progress", count: inProgress },
    { key: "todo", label: "To Do", count: todo },
    { key: "on-hold", label: "On Hold", count: onHold },
    { key: "backlog", label: "Backlog", count: overdue },
    { key: "done", label: "Done", count: done },
  ];
  const statusMax = Math.max(1, ...statusRows.map((r) => r.count));

  // Per-assignee load (active tasks + hours logged)
  const loadByAssignee = React.useMemo(() => {
    const map: Record<string, { active: number; logged: number }> = {};
    tasks.forEach((t) => {
      const id = t.task_assigned_to || "unassigned";
      if (!map[id]) map[id] = { active: 0, logged: 0 };
      if (["in-progress", "in progress", "todo", "on-hold"].includes(norm(t.task_status))) {
        map[id].active += 1;
      }
      map[id].logged += Number(t.time_spent) || 0;
    });
    return Object.entries(map)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.active - a.active || b.logged - a.logged)
      .slice(0, 10);
  }, [tasks]);
  const loadMax = Math.max(1, ...loadByAssignee.map((r) => r.active));

  // Throughput: tasks completed per day over the last 7 days (by completed_at, business tz)
  const throughput = React.useMemo(() => {
    const days: { key: string; label: string; count: number }[] = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      days.push({
        key: getLocalDateKey(d),
        label: d.toLocaleDateString(undefined, { weekday: "short" }),
        count: 0,
      });
    }
    const idx = new Map(days.map((d, i) => [d.key, i]));
    tasks.forEach((t) => {
      if (!t.completed_at) return;
      const k = getLocalDateKey(new Date(t.completed_at));
      const i = idx.get(k);
      if (i !== undefined) days[i].count += 1;
    });
    return days;
  }, [tasks]);
  const tpMax = Math.max(1, ...throughput.map((d) => d.count));

  // Velocity: completed_hours per sprint, oldest-first (most recent last) — the last several
  // cycles, using Sprints (not Epics) as the cycle boundary since sprints are the time-boxed
  // construct (scale-gaps-plan.md §B.5's burndown/velocity ask).
  const velocitySprints = React.useMemo(() => {
    return [...sprintData]
      .sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime())
      .slice(-8);
  }, [sprintData]);
  const velocityMax = Math.max(1, ...velocitySprints.map((s) => s.completed_hours));

  return (
    <SimpleLayout>
      <Container maxW="container.xl" py={8}>
        <Breadcrumb mb={2}>
          <BreadcrumbItem>
            <BreadcrumbLink as={Link} to={APP_HOME}>
              Home
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbItem isCurrentPage>
            <BreadcrumbLink href="#">Reports</BreadcrumbLink>
          </BreadcrumbItem>
        </Breadcrumb>
        <Heading size="lg" mb={6} color="neutral.900">
          Reports & Analytics
        </Heading>

        <SimpleGrid columns={{ base: 2, md: 3, lg: 6 }} spacing={4} mb={6}>
          <StatCard label="Total Tasks" value={total} />
          <StatCard label="In Progress" value={inProgress} color="blue.500" />
          <StatCard label="Completed" value={done} color="green.500" />
          <StatCard label="Backlog / Overdue" value={overdue} color="orange.500" />
          <StatCard label="Completion Rate" value={`${completionRate}%`} />
          <StatCard label="Time Logged" value={formatDuration(totalLogged)} />
        </SimpleGrid>

        <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={6} mb={6}>
          <Panel title="Status Distribution">
            <VStack align="stretch" spacing={3}>
              {statusRows.map((r) => (
                <Box key={r.key}>
                  <Flex justify="space-between" mb={1}>
                    <Text fontSize="sm" color="neutral.700">
                      {r.label}
                    </Text>
                    <Text fontSize="sm" fontWeight={600} color="neutral.900">
                      {r.count}
                    </Text>
                  </Flex>
                  <Box h="8px" bg="neutral.100" borderRadius="full" overflow="hidden">
                    <Box
                      h="100%"
                      w={`${(r.count / statusMax) * 100}%`}
                      bg={STATUS_COLORS[r.key]}
                      borderRadius="full"
                      transition="width 0.3s"
                    />
                  </Box>
                </Box>
              ))}
            </VStack>
          </Panel>

          <Panel title="Throughput — Completed (last 7 days)">
            <Flex align="end" justify="space-between" h="160px" gap={2}>
              {throughput.map((d) => (
                <VStack key={d.key} flex={1} spacing={1} justify="end" h="100%">
                  <Text fontSize="xs" fontWeight={600} color="neutral.600">
                    {d.count}
                  </Text>
                  <Box
                    w="100%"
                    h={`${(d.count / tpMax) * 100}%`}
                    minH={d.count > 0 ? "4px" : "0"}
                    bg="#4f46e5"
                    borderTopRadius="md"
                    transition="height 0.3s"
                  />
                  <Text fontSize="xs" color="neutral.500">
                    {d.label}
                  </Text>
                </VStack>
              ))}
            </Flex>
          </Panel>
        </SimpleGrid>

        <Panel title="Team Load (top 10 by active tasks)">
          {loadByAssignee.length === 0 ? (
            <Text fontSize="sm" color="neutral.500">
              No data.
            </Text>
          ) : (
            <VStack align="stretch" spacing={3}>
              {loadByAssignee.map((r) => (
                <Flex key={r.id} align="center" gap={3}>
                  <HStack w="180px" flexShrink={0} spacing={2}>
                    <Avatar
                      size="xs"
                      name={devName(r.id)}
                      bg={avatarColor(devName(r.id))}
                      color="white"
                    />
                    <Text fontSize="sm" color="neutral.700" isTruncated>
                      {devName(r.id)}
                    </Text>
                  </HStack>
                  <Box flex={1} h="10px" bg="neutral.100" borderRadius="full" overflow="hidden">
                    <Box
                      h="100%"
                      w={`${(r.active / loadMax) * 100}%`}
                      bg={getPriorityHex("P3")}
                      borderRadius="full"
                    />
                  </Box>
                  <Text fontSize="sm" color="neutral.600" w="120px" textAlign="right" flexShrink={0}>
                    {r.active} active · {formatDuration(r.logged)}
                  </Text>
                </Flex>
              ))}
            </VStack>
          )}
        </Panel>

        <Box mt={6}>
          <Panel title="Velocity — Completed Hours by Sprint">
            {velocitySprints.length === 0 ? (
              <Text fontSize="sm" color="neutral.500">
                No sprints yet —{" "}
                <Link to="/sprints" style={{ textDecoration: "underline" }}>
                  create one
                </Link>{" "}
                to start tracking velocity.
              </Text>
            ) : (
              <Flex align="end" justify="space-between" h="160px" gap={2}>
                {velocitySprints.map((s) => (
                  <VStack key={s.id} flex={1} spacing={1} justify="end" h="100%">
                    <Text fontSize="xs" fontWeight={600} color="neutral.600">
                      {formatDuration(s.completed_hours)}
                    </Text>
                    <Box
                      w="100%"
                      h={`${(s.completed_hours / velocityMax) * 100}%`}
                      minH={s.completed_hours > 0 ? "4px" : "0"}
                      bg="#0d9488"
                      borderTopRadius="md"
                      transition="height 0.3s"
                    />
                    <Text fontSize="xs" color="neutral.500" isTruncated maxW="100%" title={s.name}>
                      {s.name}
                    </Text>
                  </VStack>
                ))}
              </Flex>
            )}
          </Panel>
        </Box>
      </Container>
    </SimpleLayout>
  );
};

export default ReportsPage;
