import React, { useMemo } from "react";
import { Badge, Box, Divider, Flex, Text, HStack, VStack, Icon, Skeleton, SkeletonText } from "@chakra-ui/react";
import { FaBolt, FaExclamationCircle, FaUsers } from "Utils/icons";
import { useAppSelector } from "app/hooks";
import { useInsightsQuery } from "Services/user.api";
import { useTaskDetail } from "Contexts/useTaskDetail";
import {
  findLocalTask,
  REBALANCE_IDLE_COLOR,
  REBALANCE_OVERLOADED_COLOR,
  resolveEmpName,
  riskLevelColor,
  riskLevelLabel,
  sortAtRiskTasks,
} from "Utils/insights";

/**
 * AI Insight panel — Gemini-generated workload summary + recommendations, plus two
 * deterministic (NO Gemini) sections, all sitting on top of GET /insights (which itself sits
 * on top of /capacity and /tasks). Org-tree scoped server side: a manager sees a summary of
 * their subtree, an IC sees a summary of just their own work — this component doesn't need to
 * know which, it just renders whatever scope the backend decided on (`scope_employee_count`
 * is shown as a footnote either way).
 *
 * `available: false` (Gemini not configured, or every configured key failed) is a normal,
 * expected empty state for the summary/recommendations — not an error — per the /insights
 * contract, and is rendered as such. Critically, `at_risk_tasks`/`rebalance_suggestions` are
 * computed by deterministic backend logic BEFORE the Gemini-availability check, so they are
 * populated regardless of `available` — this component renders those two sections
 * independently of the `available` gate, never folding them into the same "unavailable" branch.
 */
const AIInsightPanel: React.FC = () => {
  const { currentUser, tasks, developers } = useAppSelector((state) => state.scheduler);
  const { openTaskDetail } = useTaskDetail();
  const { data, isLoading, isFetching, isError } = useInsightsQuery(undefined, {
    skip: !currentUser,
  });

  const loading = isLoading || (isFetching && !data);

  const atRiskTasks = useMemo(() => sortAtRiskTasks(data?.at_risk_tasks), [data?.at_risk_tasks]);
  const rebalanceSuggestions = data?.rebalance_suggestions || [];
  const hasDeterministicSections = atRiskTasks.length > 0 || rebalanceSuggestions.length > 0;

  return (
    <Box
      bg="surface.card"
      border="1px solid"
      borderColor="surface.border"
      borderRadius="card"
      boxShadow="card"
      p={5}
      mb={6}
    >
      <Flex align="center" justify="space-between" mb={4}>
        <HStack spacing={2}>
          <Flex
            w="30px"
            h="30px"
            borderRadius="0.6rem"
            align="center"
            justify="center"
            bg="brand.50"
            color="brand.600"
          >
            <Icon as={FaBolt} boxSize={4} />
          </Flex>
          <Text
            fontSize="sm"
            fontWeight={700}
            color="neutral.500"
            textTransform="uppercase"
            letterSpacing="0.04em"
          >
            AI Insight
          </Text>
          {data?.source === "rules" && (
            <Badge
              colorScheme="gray"
              variant="subtle"
              fontSize="0.65rem"
              title="Built from your team's tasks and capacity by fixed rules, without the AI model."
            >
              Rules-based
            </Badge>
          )}
        </HStack>
        {!!data?.scope_employee_count && (
          <Text fontSize="xs" color="neutral.500">
            Based on {data.scope_employee_count} employee{data.scope_employee_count === 1 ? "" : "s"}
          </Text>
        )}
      </Flex>

      {loading && (
        <VStack align="stretch" spacing={3}>
          <SkeletonText noOfLines={2} spacing={2} skeletonHeight={3} />
          <Skeleton h="10px" w="70%" borderRadius="full" />
          <Skeleton h="10px" w="55%" borderRadius="full" />
        </VStack>
      )}

      {!loading && (isError || !data || !data.available) && (
        <Flex align="start" gap={3}>
          <Icon as={FaExclamationCircle} color="neutral.400" boxSize={4} mt={0.5} />
          <Box>
            <Text fontSize="sm" fontWeight={600} color="neutral.700">
              AI insight unavailable
            </Text>
            <Text fontSize="xs" color="neutral.500" mt={1}>
              {isError
                ? "Could not reach the insight service right now."
                : "No summary is available right now."}
            </Text>
          </Box>
        </Flex>
      )}

      {!loading && !isError && data?.available && (
        <VStack align="stretch" spacing={3}>
          <Text fontSize="sm" color="neutral.800">
            {data.summary}
          </Text>
          {data.recommendations.length > 0 && (
            <VStack align="stretch" spacing={2} pt={1}>
              {data.recommendations.map((rec, i) => (
                <HStack key={i} align="start" spacing={2}>
                  <Box
                    mt="6px"
                    w="6px"
                    h="6px"
                    borderRadius="full"
                    bg="brand.500"
                    flexShrink={0}
                  />
                  <Text fontSize="sm" color="neutral.700">
                    {rec}
                  </Text>
                </HStack>
              ))}
            </VStack>
          )}
        </VStack>
      )}

      {/* The two sections below are deterministic (NO Gemini) and render whenever they have
          data, regardless of `data.available` — see the component doc comment above. */}
      {!loading && hasDeterministicSections && <Divider my={4} borderColor="surface.border" />}

      {!loading && atRiskTasks.length > 0 && (
        <Box mb={rebalanceSuggestions.length > 0 ? 4 : 0}>
          <HStack spacing={1.5} mb={2}>
            <Icon as={FaExclamationCircle} color="neutral.400" boxSize={3} />
            <Text
              fontSize="xs"
              fontWeight={700}
              color="neutral.500"
              textTransform="uppercase"
              letterSpacing="0.04em"
            >
              At-Risk Tasks
            </Text>
          </HStack>
          <VStack align="stretch" spacing={1}>
            {atRiskTasks.map((item) => {
              const localTask = findLocalTask(item.task_id, tasks);
              const handleOpen = () => {
                if (localTask) openTaskDetail(localTask);
              };
              return (
                <Flex
                  key={item.task_id}
                  align="start"
                  gap={2}
                  p={2}
                  borderRadius="0.5rem"
                  cursor={localTask ? "pointer" : "default"}
                  role={localTask ? "button" : undefined}
                  tabIndex={localTask ? 0 : undefined}
                  _hover={localTask ? { bg: "neutral.50" } : undefined}
                  onClick={localTask ? handleOpen : undefined}
                  onKeyDown={
                    localTask
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleOpen();
                          }
                        }
                      : undefined
                  }
                >
                  <Box flex={1} minW={0}>
                    <HStack spacing={2} wrap="wrap">
                      <Text fontSize="sm" fontWeight={600} color="neutral.800" noOfLines={1}>
                        {item.task_name}
                      </Text>
                      <Badge
                        bg={riskLevelColor(item.risk_level)}
                        color="white"
                        fontSize="9px"
                        flexShrink={0}
                      >
                        {riskLevelLabel(item.risk_level)}
                      </Badge>
                    </HStack>
                    <Text fontSize="xs" color="neutral.500" mt={0.5}>
                      {item.reason}
                    </Text>
                  </Box>
                </Flex>
              );
            })}
          </VStack>
        </Box>
      )}

      {!loading && rebalanceSuggestions.length > 0 && (
        <Box>
          <HStack spacing={1.5} mb={2}>
            <Icon as={FaUsers} color="neutral.400" boxSize={3} />
            <Text
              fontSize="xs"
              fontWeight={700}
              color="neutral.500"
              textTransform="uppercase"
              letterSpacing="0.04em"
            >
              Rebalance Suggestions
            </Text>
          </HStack>
          <VStack align="stretch" spacing={1}>
            {rebalanceSuggestions.map((s, i) => (
              <Box key={`${s.overloaded_emp_id}-${s.idle_emp_id}-${i}`} p={2} borderRadius="0.5rem">
                <HStack spacing={1.5} fontSize="sm" fontWeight={600}>
                  <Text color={REBALANCE_OVERLOADED_COLOR}>
                    {resolveEmpName(s.overloaded_emp_id, developers)}
                  </Text>
                  <Text color="neutral.400">→</Text>
                  <Text color={REBALANCE_IDLE_COLOR}>
                    {resolveEmpName(s.idle_emp_id, developers)}
                  </Text>
                </HStack>
                <Text fontSize="xs" color="neutral.500" mt={0.5}>
                  {s.reason}
                </Text>
              </Box>
            ))}
          </VStack>
        </Box>
      )}
    </Box>
  );
};

export default AIInsightPanel;
