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
  Select,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  Badge,
  CircularProgress,
  CircularProgressLabel,
  Tooltip,
} from "@chakra-ui/react";
import { Link } from "react-router-dom";
import SimpleLayout from "Layouts/simpleLayout";
import { useAppSelector } from "app/hooks";
import { useCapacityQuery, useUserListQuery } from "Services/user.api";
import { CapacityDay } from "types";
import UserAvatar from "Components/UserAvatar";
import {
  ALL_DEPARTMENTS,
  capacityBarWidthPct,
  capacityStatusColor,
  capacityStatusLabel,
  computeEfficiencyIndex,
  enrichCapacityEmployees,
  filterByDepartment,
  formatTimezoneLabel,
  formatUtilizationLabel,
  getDepartmentOptions,
  groupRowsByTimezone,
  heatmapColor,
} from "Utils/capacity";
import { APP_HOME } from "Utils/constants";

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
    <Text fontSize="xs" color="neutral.500" mt={1} textTransform="uppercase" letterSpacing="0.04em">
      {label}
    </Text>
  </Box>
);

const Panel: React.FC<{ title: string; children: React.ReactNode; action?: React.ReactNode }> = ({
  title,
  children,
  action,
}) => (
  <Box
    bg="surface.card"
    border="1px solid"
    borderColor="surface.border"
    borderRadius="card"
    boxShadow="card"
    p={5}
  >
    <Flex justify="space-between" align="center" mb={4}>
      <Text
        fontSize="sm"
        fontWeight={700}
        color="neutral.500"
        textTransform="uppercase"
        letterSpacing="0.04em"
      >
        {title}
      </Text>
      {action}
    </Flex>
    {children}
  </Box>
);

/** One employee's capacity across the selected horizon: one small segment per day, each a
 * filled bar labeled with its percentage. Deliberately a plain Chakra Box bar, not a
 * charting library. Wraps onto further rows (parent `Flex` has `wrap="wrap"`) rather than
 * scaling infinitely wide at longer horizons. */
const CapacityBar: React.FC<{ days: CapacityDay[] }> = ({ days }) => (
  <HStack spacing={3} minW="220px">
    {days.map((d) => (
      <Tooltip
        key={d.date}
        label={`${d.date}: ${d.committed_seconds}s committed / ${d.available_seconds}s available`}
        placement="top"
        hasArrow
      >
        <VStack align="stretch" spacing={0.5} flex={1}>
          <Box h="8px" bg="neutral.100" borderRadius="full" overflow="hidden">
            <Box
              h="100%"
              w={`${capacityBarWidthPct(d)}%`}
              bg={heatmapColor(d.utilization_pct)}
              borderRadius="full"
              transition="width 0.3s"
            />
          </Box>
          <Text fontSize="xs" color="neutral.500">
            {formatUtilizationLabel(d.utilization_pct)}
          </Text>
        </VStack>
      </Tooltip>
    ))}
  </HStack>
);

// Horizon options for the capacity forecast — 2 days is the original "next-48h" default;
// the rest let a resource planner pull a multi-week forecast (scale-gaps-plan.md §B.6).
// Server-side clamps at 28 (MAX_CAPACITY_HORIZON_DAYS) regardless of what's requested here.
const HORIZON_OPTIONS = [
  { value: 2, label: "Next 2 days (48h)" },
  { value: 7, label: "Next 7 days" },
  { value: 14, label: "Next 14 days" },
  { value: 28, label: "Next 28 days" },
];

const OrganizationResourceView: React.FC = () => {
  const { currentUser } = useAppSelector((state) => state.scheduler);
  const [horizonDays, setHorizonDays] = React.useState(2);
  const { data: capacityData, isLoading, isFetching } = useCapacityQuery(
    { days: horizonDays },
    { skip: !currentUser, refetchOnMountOrArgChange: true },
  );
  // /capacity doesn't carry emp_department/profile_pic (see main.py's _capacity_for_employee —
  // deliberately lean); join against the user directory (already fetched everywhere else in
  // the app) so the department filter and avatars have something to work with.
  const { data: userData } = useUserListQuery(undefined, { skip: !currentUser });

  const [department, setDepartment] = React.useState(ALL_DEPARTMENTS);

  const rows = React.useMemo(
    () => enrichCapacityEmployees(capacityData?.employees ?? [], userData ?? []),
    [capacityData, userData],
  );
  const departmentOptions = React.useMemo(() => getDepartmentOptions(rows), [rows]);
  const filteredRows = React.useMemo(
    () => filterByDepartment(rows, department),
    [rows, department],
  );
  // Heatmap rows grouped into a section per distinct employee timezone (sorted alphabetically
  // by IANA name) — see Utils/capacity.ts's groupRowsByTimezone. This is what lets the
  // Saturation Heatmap actually read as "across timezones" rather than a flat list.
  const timezoneGroups = React.useMemo(
    () => groupRowsByTimezone(filteredRows),
    [filteredRows],
  );

  const summary = capacityData?.summary;
  const efficiencyIndex = React.useMemo(
    () => (summary ? computeEfficiencyIndex(summary) : 0),
    [summary],
  );
  // Days shared by every row, per the selected horizon — used as the heatmap's column headers.
  const dayHeaders = filteredRows[0]?.days.map((d) => d.date) ?? [];

  const loading = isLoading || (isFetching && !capacityData);

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
            <BreadcrumbLink href="#">Resources</BreadcrumbLink>
          </BreadcrumbItem>
        </Breadcrumb>
        <Flex justify="space-between" align="center" mb={6} wrap="wrap" gap={3}>
          <Heading size="lg" color="neutral.900">
            Organization Resource View
          </Heading>
          <Select
            size="sm"
            maxW="200px"
            value={horizonDays}
            onChange={(e) => setHorizonDays(Number(e.target.value))}
          >
            {HORIZON_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Flex>

        {!loading && !summary && (
          <Text fontSize="sm" color="neutral.500">
            No capacity data available.
          </Text>
        )}

        {summary && (
          <>
            <SimpleGrid columns={{ base: 2, md: 4 }} spacing={4} mb={6}>
              <StatCard label="Total Employees" value={summary.total_employees} />
              <StatCard label="Available" value={summary.available_count} color="green.600" />
              <StatCard
                label="Over-capacitated"
                value={summary.over_capacitated_count}
                color="red.600"
              />
              <StatCard
                label="Avg Utilization"
                value={`${summary.avg_utilization_pct}%`}
                color="brand.600"
              />
            </SimpleGrid>

            <SimpleGrid columns={{ base: 1, lg: 3 }} spacing={6} mb={6}>
              {/* Resource Efficiency Index gauge — see Utils/capacity.ts's computeEfficiencyIndex
                  for the formula and rationale (avg utilization weighted 0.7, blended with the
                  inverse of the over-capacitated ratio weighted 0.3). */}
              <Panel title="Resource Efficiency Index">
                <Flex justify="center" py={2}>
                  <CircularProgress
                    value={efficiencyIndex}
                    size="140px"
                    thickness="10px"
                    color={heatmapColor(efficiencyIndex)}
                    trackColor="neutral.100"
                    capIsRound
                  >
                    <CircularProgressLabel>
                      <Text fontSize="2xl" fontWeight={800} color="neutral.900">
                        {efficiencyIndex}
                      </Text>
                      <Text fontSize="xs" color="neutral.500">
                        / 100
                      </Text>
                    </CircularProgressLabel>
                  </CircularProgress>
                </Flex>
                <Text fontSize="xs" color="neutral.500" textAlign="center" mt={2}>
                  Avg utilization blended with overcommitment risk
                </Text>
              </Panel>

              {/* Team Saturation Heatmap — a grid of however many days the selected horizon
                  requests (2-28, see HORIZON_OPTIONS). Each row is labeled with its employee's
                  resolved timezone, and rows are grouped into a section per distinct timezone
                  (sorted alphabetically — see Utils/capacity.ts's groupRowsByTimezone) so the
                  heatmap genuinely reads as "across timezones" rather than one flat list on a
                  single shared clock. */}
              <Box gridColumn={{ lg: "span 2" }}>
                <Panel title={`Team Saturation Heatmap (next ${horizonDays} day${horizonDays === 1 ? "" : "s"})`}>
                  {filteredRows.length === 0 ? (
                    <Text fontSize="sm" color="neutral.500">
                      No employees in this scope.
                    </Text>
                  ) : (
                    <Box overflowX="auto">
                      <VStack align="stretch" spacing={3} minW="360px">
                        <Flex gap={2}>
                          <Box w="140px" flexShrink={0} />
                          {dayHeaders.map((d) => (
                            <Text key={d} flex={1} fontSize="xs" color="neutral.500" textAlign="center">
                              {d}
                            </Text>
                          ))}
                        </Flex>
                        {timezoneGroups.map((group) => (
                          <VStack key={group.timezone} align="stretch" spacing={1.5}>
                            <Text
                              fontSize="xs"
                              fontWeight={700}
                              color="neutral.400"
                              textTransform="uppercase"
                              letterSpacing="0.04em"
                              borderTop="1px solid"
                              borderColor="surface.border"
                              pt={1.5}
                            >
                              {group.timezone} · {group.rows.length}{" "}
                              {group.rows.length === 1 ? "person" : "people"}
                            </Text>
                            {group.rows.map((r) => (
                              <Flex key={r.emp_id} gap={2} align="center">
                                <Box w="140px" flexShrink={0}>
                                  <Text fontSize="sm" color="neutral.700" isTruncated>
                                    {r.emp_name}
                                  </Text>
                                </Box>
                                {r.days.map((d) => (
                                  <Tooltip
                                    key={d.date}
                                    label={`${r.emp_name} (${r.timezone}) — ${d.date}: ${formatUtilizationLabel(d.utilization_pct)}`}
                                    hasArrow
                                  >
                                    <Box
                                      flex={1}
                                      h="28px"
                                      borderRadius="md"
                                      bg={heatmapColor(d.utilization_pct)}
                                      display="flex"
                                      alignItems="center"
                                      justifyContent="center"
                                    >
                                      <Text fontSize="xs" fontWeight={600} color="neutral.900">
                                        {formatUtilizationLabel(d.utilization_pct)}
                                      </Text>
                                    </Box>
                                  </Tooltip>
                                ))}
                              </Flex>
                            ))}
                          </VStack>
                        ))}
                      </VStack>
                    </Box>
                  )}
                </Panel>
              </Box>
            </SimpleGrid>

            <Panel
              title="Employee Availability"
              action={
                departmentOptions.length > 0 ? (
                  <Select
                    size="sm"
                    maxW="200px"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                  >
                    <option value={ALL_DEPARTMENTS}>All Departments</option>
                    {departmentOptions.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </Select>
                ) : undefined
              }
            >
              {filteredRows.length === 0 ? (
                <Text fontSize="sm" color="neutral.500">
                  No employees match this filter.
                </Text>
              ) : (
                <VStack align="stretch" spacing={3}>
                  {filteredRows.map((r) => (
                    <Flex
                      key={r.emp_id}
                      align="center"
                      gap={4}
                      wrap="wrap"
                      py={2}
                      borderBottom="1px solid"
                      borderColor="surface.border"
                    >
                      <HStack w="220px" flexShrink={0} spacing={2}>
                        <UserAvatar size="sm" name={r.emp_name} photo={r.profile_pic} />
                        <Box minW={0}>
                          <HStack spacing={1.5}>
                            <Text fontSize="sm" fontWeight={600} color="neutral.800" isTruncated>
                              {r.emp_name}
                            </Text>
                            <Tooltip label={`Timezone: ${r.timezone}`} hasArrow>
                              <Badge
                                fontSize="9px"
                                fontWeight={600}
                                colorScheme="gray"
                                variant="subtle"
                                flexShrink={0}
                              >
                                {formatTimezoneLabel(r.timezone)}
                              </Badge>
                            </Tooltip>
                          </HStack>
                          {r.emp_department && (
                            <Text fontSize="xs" color="neutral.500" isTruncated>
                              {r.emp_department}
                            </Text>
                          )}
                        </Box>
                      </HStack>
                      <Badge
                        bg={capacityStatusColor(r.status)}
                        color="white"
                        flexShrink={0}
                      >
                        {capacityStatusLabel(r.status)}
                      </Badge>
                      <Box flex={1} minW="220px">
                        <CapacityBar days={r.days} />
                      </Box>
                    </Flex>
                  ))}
                </VStack>
              )}
            </Panel>
          </>
        )}
      </Container>
    </SimpleLayout>
  );
};

export default OrganizationResourceView;
