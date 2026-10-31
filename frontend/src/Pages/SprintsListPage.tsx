import React, { useEffect, useState } from "react";
import {
  Box,
  Flex,
  Heading,
  Text,
  Icon,
  Button,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Progress,
  HStack,
  Spinner,
  useDisclosure,
} from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";
import SimpleLayout from "Layouts/simpleLayout";
import { useSprintListQuery } from "Services/user.api";
import { FaBolt, FaPlus } from "Utils/icons";
import { formatDuration } from "Utils/common";
import { sprintStatusMeta } from "Utils/sprintStatus";
import SprintCreationModal from "Components/Sprints/SprintCreationModal";

const formatDateRange = (start: string, end: string): string =>
  `${new Date(start).toLocaleDateString()} → ${new Date(end).toLocaleDateString()}`;

/** Company-wide Sprints list — a time-boxed cycle, same "everyone sees the same list" reasoning
 * as Epics (see EpicsListPage), not org-tree scoped. Table style/tokens mirror EpicsListPage. */
const SprintsListPage: React.FC = () => {
  const navigate = useNavigate();
  const { data: sprints = [], isFetching, isError } = useSprintListQuery();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);

  const handleCreated = (sprintId: string) => {
    setPendingOpenId(sprintId);
  };

  // Same "wait for the invalidated list refetch before navigating" pattern as EpicsListPage,
  // rather than racing the modal's own close.
  useEffect(() => {
    if (pendingOpenId && !isFetching) {
      navigate(`/sprints/${pendingOpenId}`);
      setPendingOpenId(null);
    }
  }, [pendingOpenId, isFetching, navigate]);

  return (
    <SimpleLayout>
      <Box>
        <Flex align="center" justify="space-between" mb={1} wrap="wrap" gap={3}>
          <Flex align="center" gap={3}>
            <Icon as={FaBolt} color="brand.600" boxSize={5} />
            <Heading size="lg" color="neutral.900">
              Sprints
            </Heading>
          </Flex>
          <Button leftIcon={<FaPlus />} onClick={onOpen}>
            Create Sprint
          </Button>
        </Flex>
        <Text color="neutral.500" fontSize="sm" mb={6}>
          Time-boxed cycles tasks can optionally be scoped to
          {sprints.length > 0
            ? ` — ${sprints.length} sprint${sprints.length === 1 ? "" : "s"}.`
            : "."}
        </Text>

        <Box
          bg="surface.card"
          border="1px solid"
          borderColor="surface.border"
          borderRadius="card"
          boxShadow="card"
          overflow="hidden"
        >
          {isFetching && sprints.length === 0 ? (
            <Flex align="center" justify="center" py={16} direction="column" gap={3}>
              <Spinner />
              <Text color="neutral.500" fontSize="sm">
                Loading sprints…
              </Text>
            </Flex>
          ) : isError ? (
            <Flex align="center" justify="center" py={16} direction="column" gap={2}>
              <Text color="neutral.700" fontWeight={600}>
                Sprints unavailable
              </Text>
              <Text color="neutral.500" fontSize="sm">
                Couldn't load sprints right now. Try refreshing the page.
              </Text>
            </Flex>
          ) : (
            <Box overflowX="auto" w="100%">
              <Table variant="unstyled" sx={{ width: "max-content", minWidth: "100%" }}>
                <Thead bg="neutral.50">
                  <Tr>
                    {["Sprint", "Status", "Dates", "Tasks", "Hours"].map((h) => (
                      <Th key={h} py={3.5} fontSize="xs" color="neutral.500" letterSpacing="0.04em">
                        {h}
                      </Th>
                    ))}
                  </Tr>
                </Thead>
                <Tbody>
                  {sprints.map((sprint) => {
                    const sm = sprintStatusMeta(sprint.status_label);
                    return (
                      <Tr
                        key={sprint.id}
                        role="button"
                        tabIndex={0}
                        cursor="pointer"
                        borderTop="1px solid"
                        borderColor="surface.border"
                        transition="background 0.15s ease"
                        _hover={{ bg: "neutral.50" }}
                        onClick={() => navigate(`/sprints/${sprint.id}`)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            navigate(`/sprints/${sprint.id}`);
                          }
                        }}
                      >
                        <Td py={4}>
                          <Flex align="center" gap={1.5}>
                            <Box as={FaBolt} color="brand.600" boxSize="12px" flexShrink={0} />
                            <Text fontSize="sm" fontWeight={600} color="neutral.900" isTruncated>
                              {sprint.name}
                            </Text>
                          </Flex>
                        </Td>
                        <Td whiteSpace="nowrap">
                          <HStack spacing={2}>
                            <Box w="8px" h="8px" borderRadius="full" bg={sm.color} flexShrink={0} />
                            <Text fontSize="sm" color="neutral.700" whiteSpace="nowrap">
                              {sm.label}
                            </Text>
                          </HStack>
                        </Td>
                        <Td whiteSpace="nowrap">
                          <Text fontSize="sm" color="neutral.700">
                            {formatDateRange(sprint.start_date, sprint.end_date)}
                          </Text>
                        </Td>
                        <Td minW="180px">
                          <Flex align="center" gap={2}>
                            <Progress
                              value={sprint.task_total ? (sprint.task_done / sprint.task_total) * 100 : 0}
                              size="sm"
                              borderRadius="full"
                              colorScheme="brand"
                              bg="neutral.100"
                              flex={1}
                              minW="90px"
                            />
                            <Text fontSize="xs" color="neutral.500" whiteSpace="nowrap">
                              {sprint.task_done}/{sprint.task_total}
                            </Text>
                          </Flex>
                        </Td>
                        <Td whiteSpace="nowrap">
                          <Text fontSize="sm" color="neutral.700">
                            {formatDuration(sprint.completed_hours)} / {formatDuration(sprint.total_hours)}
                          </Text>
                        </Td>
                      </Tr>
                    );
                  })}
                  {!isFetching && sprints.length === 0 && (
                    <Tr>
                      <Td colSpan={5} textAlign="center" py={10} color="neutral.500">
                        No sprints yet. Create one to get started.
                      </Td>
                    </Tr>
                  )}
                </Tbody>
              </Table>
            </Box>
          )}
        </Box>
      </Box>

      <SprintCreationModal isOpen={isOpen} onClose={onClose} onCreated={handleCreated} />
    </SimpleLayout>
  );
};

export default SprintsListPage;
