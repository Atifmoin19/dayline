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
  Badge,
  Progress,
  HStack,
  Spinner,
  useDisclosure,
} from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";
import SimpleLayout from "Layouts/simpleLayout";
import { useAppSelector } from "app/hooks";
import { useEpicListQuery } from "Services/user.api";
import { FaFlag, FaPlus, FaBookmark } from "Utils/icons";
import UserAvatar from "Components/UserAvatar";
import EpicCreationModal from "Components/Epics/EpicCreationModal";
import { epicStatusMeta } from "Utils/epicStatus";

/** Company-wide Epics list — a cross-team initiative spans teams by definition, so (like the
 * Organization/org-chart view) there's no "my epics" org-tree scoping: everyone sees the same
 * list. Table style/tokens match `TaskListingView`. */
const EpicsListPage: React.FC = () => {
  const navigate = useNavigate();
  const developers = useAppSelector((state) => state.scheduler.developers);
  const { data: epics = [], isFetching, isError } = useEpicListQuery();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);

  const handleCreated = (epicId: string) => {
    setPendingOpenId(epicId);
  };

  // Navigate to the freshly-created epic only after the list refetch (invalidated by
  // createEpic) has actually resolved, rather than racing the modal's own close.
  useEffect(() => {
    if (pendingOpenId && !isFetching) {
      navigate(`/epics/${pendingOpenId}`);
      setPendingOpenId(null);
    }
  }, [pendingOpenId, isFetching, navigate]);

  return (
    <SimpleLayout>
      <Box>
        <Flex align="center" justify="space-between" mb={1} wrap="wrap" gap={3}>
          <Flex align="center" gap={3}>
            <Icon as={FaFlag} color="brand.600" boxSize={5} />
            <Heading size="lg" color="neutral.900">
              Epics
            </Heading>
          </Flex>
          <Button leftIcon={<FaPlus />} onClick={onOpen}>
            Create Epic
          </Button>
        </Flex>
        <Text color="neutral.500" fontSize="sm" mb={6}>
          Cross-team initiatives that a set of stories roll up into
          {epics.length > 0 ? ` — ${epics.length} epic${epics.length === 1 ? "" : "s"}.` : "."}
        </Text>

        <Box
          bg="surface.card"
          border="1px solid"
          borderColor="surface.border"
          borderRadius="card"
          boxShadow="card"
          overflow="hidden"
        >
          {isFetching && epics.length === 0 ? (
            <Flex align="center" justify="center" py={16} direction="column" gap={3}>
              <Spinner />
              <Text color="neutral.500" fontSize="sm">
                Loading epics…
              </Text>
            </Flex>
          ) : isError ? (
            <Flex align="center" justify="center" py={16} direction="column" gap={2}>
              <Text color="neutral.700" fontWeight={600}>
                Epics unavailable
              </Text>
              <Text color="neutral.500" fontSize="sm">
                Couldn't load epics right now. Try refreshing the page.
              </Text>
            </Flex>
          ) : (
            <Box overflowX="auto" w="100%">
              <Table variant="unstyled" sx={{ width: "max-content", minWidth: "100%" }}>
                <Thead bg="neutral.50">
                  <Tr>
                    {["Epic", "Status", "Owner", "Department", "Progress"].map((h) => (
                      <Th key={h} py={3.5} fontSize="xs" color="neutral.500" letterSpacing="0.04em">
                        {h}
                      </Th>
                    ))}
                  </Tr>
                </Thead>
                <Tbody>
                  {epics.map((epic) => {
                    const owner = developers.find((d) => d.emp_id === epic.owner_id);
                    const sm = epicStatusMeta(epic.status);
                    return (
                      <Tr
                        key={epic.id}
                        role="button"
                        tabIndex={0}
                        cursor="pointer"
                        borderTop="1px solid"
                        borderColor="surface.border"
                        transition="background 0.15s ease"
                        _hover={{ bg: "neutral.50" }}
                        onClick={() => navigate(`/epics/${epic.id}`)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            navigate(`/epics/${epic.id}`);
                          }
                        }}
                      >
                        <Td py={4}>
                          <Flex align="center" gap={1.5}>
                            <Box as={FaBookmark} color="brand.600" boxSize="12px" fill="currentColor" flexShrink={0} />
                            <Box minW={0}>
                              {epic.ticket_id && (
                                <Text fontSize="xs" fontWeight={700} color="brand.600">
                                  {epic.ticket_id}
                                </Text>
                              )}
                              <Text fontSize="sm" fontWeight={600} color="neutral.900" isTruncated>
                                {epic.name}
                              </Text>
                            </Box>
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
                          {owner ? (
                            <Flex align="center" gap={2}>
                              <UserAvatar size="xs" name={owner.emp_name} photo={owner.profile_pic} />
                              <Text fontSize="sm" color="neutral.700" isTruncated maxW="140px">
                                {owner.emp_name}
                              </Text>
                            </Flex>
                          ) : (
                            <Text fontSize="sm" color="neutral.500">
                              Unassigned
                            </Text>
                          )}
                        </Td>
                        <Td whiteSpace="nowrap">
                          {epic.department ? (
                            <Badge colorScheme="gray" variant="subtle">
                              {epic.department}
                            </Badge>
                          ) : (
                            <Text fontSize="sm" color="neutral.400">
                              —
                            </Text>
                          )}
                        </Td>
                        <Td minW="180px">
                          <Flex align="center" gap={2}>
                            <Progress
                              value={epic.progress_pct}
                              size="sm"
                              borderRadius="full"
                              colorScheme="brand"
                              bg="neutral.100"
                              flex={1}
                              minW="90px"
                            />
                            <Text fontSize="xs" color="neutral.500" whiteSpace="nowrap">
                              {epic.story_done}/{epic.story_total}
                            </Text>
                          </Flex>
                        </Td>
                      </Tr>
                    );
                  })}
                  {!isFetching && epics.length === 0 && (
                    <Tr>
                      <Td colSpan={5} textAlign="center" py={10} color="neutral.500">
                        No epics yet. Create one to get started.
                      </Td>
                    </Tr>
                  )}
                </Tbody>
              </Table>
            </Box>
          )}
        </Box>
      </Box>

      <EpicCreationModal isOpen={isOpen} onClose={onClose} onCreated={handleCreated} />
    </SimpleLayout>
  );
};

export default EpicsListPage;
