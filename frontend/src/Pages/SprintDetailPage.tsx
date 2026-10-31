import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Box,
  Flex,
  Grid,
  GridItem,
  Text,
  Heading,
  Badge,
  Button,
  IconButton,
  Input,
  Progress,
  HStack,
  VStack,
  Spinner,
  useToast,
} from "@chakra-ui/react";
import SimpleLayout from "Layouts/simpleLayout";
import { useAppSelector } from "app/hooks";
import { useTaskDetail } from "Contexts/useTaskDetail";
import { useGetSprintQuery, useUpdateSprintMutation, useDeleteSprintMutation } from "Services/user.api";
import { getApiErrorMessage } from "Services/baseQuery";
import { Sprint, SprintCreatePayload } from "types";
import { ADMIN_ROLES, SUPER_ADMIN_ROLES } from "Utils/constants";
import { FaChevronLeft, FaTrash, FaBolt } from "Utils/icons";
import { formatDuration } from "Utils/common";
import { getPriorityColor } from "Utils/priority";
import { sprintStatusMeta } from "Utils/sprintStatus";
import {
  LABEL_PROPS as SECTION_LABEL_PROPS,
  cardFieldProps,
  sidebarPanelProps,
} from "Components/Timeline/taskModalStyles";
import SprintBurndownChart from "Components/Sprints/SprintBurndownChart";

// yyyy-mm-dd for a native <input type="date">; "" when unset so the input shows empty rather
// than "Invalid Date".
const isoToDateInput = (iso?: string): string => (iso ? iso.slice(0, 10) : "");

// End-of-day for end_date (so "today" as an end date reads as still-in-progress until it's
// actually over) vs. start-of-day for start_date.
const dateInputToIso = (value: string, endOfDay: boolean): string | undefined =>
  value ? new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}`).toISOString() : undefined;

/**
 * Sprint detail/edit page — a full route (`/sprints/:sprintId`), same reasoning as
 * `EpicDetailPage`: sprints are only ever opened from the list page. Structured fields autosave
 * on change. Only the sprint's creator or an admin can edit/delete — enforced server-side, but
 * hidden here too so non-permitted users don't hit a 403 (same convention as EpicDetailPage).
 */
const SprintDetailPage: React.FC = () => {
  const { sprintId } = useParams<{ sprintId: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { openTaskDetail } = useTaskDetail();
  const developers = useAppSelector((state) => state.scheduler.developers);
  const currentUser = useAppSelector((state) => state.scheduler.currentUser);

  const { data: sprintData, isFetching, isError } = useGetSprintQuery(sprintId ?? "", {
    skip: !sprintId,
  });
  const [updateSprintApi] = useUpdateSprintMutation();
  const [deleteSprintApi, { isLoading: isDeleting }] = useDeleteSprintMutation();

  // Local editable copy, reseeded whenever a fresh server response lands — same shape as
  // EpicDetailPage's draft/saveField.
  const [draft, setDraft] = useState<Sprint | null>(null);
  useEffect(() => {
    if (sprintData) setDraft(sprintData);
  }, [sprintData]);

  const saveField = async (patch: SprintCreatePayload) => {
    if (!draft) return;
    const previous = draft;
    setDraft({ ...draft, ...patch } as Sprint);
    try {
      const resp = await updateSprintApi({ id: draft.id, ...patch }).unwrap();
      if (resp) setDraft((prev) => (prev ? { ...prev, ...resp } : resp));
    } catch (e) {
      setDraft(previous);
      toast({
        title: "Failed to save change",
        description: getApiErrorMessage(e),
        status: "error",
      });
    }
  };

  const handleStartDateChange = (value: string) => {
    if (!value) {
      toast({ title: "Start date is required", status: "error" });
      return;
    }
    const iso = dateInputToIso(value, false);
    if (iso && draft?.end_date && new Date(iso) >= new Date(draft.end_date)) {
      toast({ title: "Start date must be before the end date", status: "error" });
      return;
    }
    saveField({ start_date: iso });
  };

  const handleEndDateChange = (value: string) => {
    if (!value) {
      toast({ title: "End date is required", status: "error" });
      return;
    }
    const iso = dateInputToIso(value, true);
    if (iso && draft?.start_date && new Date(iso) <= new Date(draft.start_date)) {
      toast({ title: "End date must be after the start date", status: "error" });
      return;
    }
    saveField({ end_date: iso });
  };

  const handleDelete = async () => {
    if (!draft) return;
    if (
      !window.confirm(`Delete sprint "${draft.name}"? Its linked tasks will be detached, not deleted.`)
    ) {
      return;
    }
    try {
      await deleteSprintApi(draft.id).unwrap();
      toast({ title: "Sprint deleted", status: "success" });
      navigate("/sprints");
    } catch (e) {
      toast({
        title: "Failed to delete sprint",
        description: getApiErrorMessage(e),
        status: "error",
      });
    }
  };

  const isManagement =
    !!currentUser &&
    (ADMIN_ROLES.includes(currentUser.emp_designation) ||
      SUPER_ADMIN_ROLES.includes(currentUser.emp_designation));
  const canManage = !!currentUser && !!draft && (draft.created_by === currentUser.emp_id || isManagement);

  const creator = developers.find((d) => d.emp_id === draft?.created_by);
  const sm = sprintStatusMeta(draft?.status_label);

  return (
    <SimpleLayout>
      <Box mb={4}>
        <Button leftIcon={<FaChevronLeft />} variant="ghost" size="sm" onClick={() => navigate("/sprints")}>
          Back to Sprints
        </Button>
      </Box>

      <Box
        bg="surface.card"
        border="1px solid"
        borderColor="surface.border"
        borderRadius="card"
        boxShadow="card"
        overflow="hidden"
      >
        {!draft && isFetching ? (
          <Flex align="center" justify="center" h="300px" direction="column" gap={3}>
            <Spinner />
            <Text color="neutral.500" fontSize="sm">
              Loading sprint…
            </Text>
          </Flex>
        ) : !draft || isError ? (
          <Flex align="center" justify="center" h="300px" direction="column" gap={2}>
            <Text color="neutral.700" fontWeight={600}>
              Sprint not found
            </Text>
            <Text color="neutral.500" fontSize="sm">
              It may have been deleted, or you don't have access to it.
            </Text>
          </Flex>
        ) : (
          <>
            {/* Header */}
            <Flex
              justify="space-between"
              align="start"
              gap={3}
              borderBottom="1px solid"
              borderColor="surface.border"
              px={{ base: 4, md: 8 }}
              py={4}
            >
              <Box flex={1} minW={0}>
                <HStack spacing={1.5} fontSize="xs" color="neutral.500" mb={1}>
                  <Box as={FaBolt} boxSize="10px" color="brand.600" />
                  <Text>Sprint</Text>
                </HStack>
                {canManage ? (
                  <Input
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    onBlur={(e) => {
                      if (e.target.value.trim() && e.target.value !== sprintData?.name) {
                        saveField({ name: e.target.value });
                      }
                    }}
                    fontSize="xl"
                    fontWeight={700}
                    px={0}
                    border="none"
                    _focus={{ boxShadow: "none", bg: "neutral.50" }}
                    h="auto"
                  />
                ) : (
                  <Heading size="lg" color="neutral.900">
                    {draft.name}
                  </Heading>
                )}
              </Box>
              {canManage && (
                <IconButton
                  aria-label="Delete sprint"
                  icon={<FaTrash />}
                  variant="ghost"
                  size="sm"
                  colorScheme="red"
                  isLoading={isDeleting}
                  onClick={handleDelete}
                />
              )}
            </Flex>

            {/* Body */}
            <Box px={{ base: 4, md: 8 }} py={6}>
              <Grid templateColumns={{ base: "1fr", md: "3fr 1.2fr" }} gap={8}>
                <GridItem>
                  <VStack align="stretch" spacing={6}>
                    <Box>
                      <Text {...SECTION_LABEL_PROPS} mb={3}>
                        Burndown
                      </Text>
                      <SprintBurndownChart sprintId={draft.id} />
                    </Box>

                    <Box>
                      <Flex align="center" justify="space-between" mb={2}>
                        <Text {...SECTION_LABEL_PROPS}>
                          Tasks ({draft.task_done}/{draft.task_total})
                        </Text>
                      </Flex>
                      {!!draft.task_total && (
                        <Progress
                          value={(draft.task_done / draft.task_total) * 100}
                          size="sm"
                          borderRadius="full"
                          colorScheme="brand"
                          bg="neutral.100"
                          mb={3}
                        />
                      )}
                      {!draft.tasks || draft.tasks.length === 0 ? (
                        <Text fontSize="sm" color="neutral.500">
                          No tasks linked yet. Attach this sprint from a task's Sprint field.
                        </Text>
                      ) : (
                        <VStack align="stretch" spacing={2}>
                          {draft.tasks.map((task) => {
                            const assignee = developers.find((d) => d.emp_id === task.task_assigned_to);
                            const isDone = ["done", "completed"].includes(
                              (task.task_status || "").toLowerCase(),
                            );
                            return (
                              <Flex
                                key={task.id}
                                as="button"
                                type="button"
                                onClick={() => openTaskDetail(task)}
                                align="center"
                                justify="space-between"
                                gap={3}
                                p={3}
                                bg="white"
                                border="1px solid"
                                borderColor="surface.border"
                                borderRadius="0.75rem"
                                textAlign="left"
                                _hover={{ borderColor: "brand.300", boxShadow: "sm" }}
                              >
                                <Flex align="center" gap={2} minW={0} flex={1}>
                                  <Text fontSize="xs" color="neutral.500" flexShrink={0}>
                                    {task.ticket_id || `#${task.id.slice(-6).toUpperCase()}`}
                                  </Text>
                                  <Text
                                    fontSize="sm"
                                    fontWeight={600}
                                    color="neutral.900"
                                    textDecoration={isDone ? "line-through" : undefined}
                                    isTruncated
                                  >
                                    {task.task_name}
                                  </Text>
                                </Flex>
                                <Flex align="center" gap={2} flexShrink={0}>
                                  {task.task_priority && (
                                    <Badge colorScheme={getPriorityColor(task.task_priority)} fontSize="0.6rem">
                                      {task.task_priority}
                                    </Badge>
                                  )}
                                  <Text fontSize="xs" fontWeight={600} color="neutral.700" isTruncated maxW="110px">
                                    {assignee?.emp_name || task.task_assigned_to || "Unassigned"}
                                  </Text>
                                </Flex>
                              </Flex>
                            );
                          })}
                        </VStack>
                      )}
                    </Box>
                  </VStack>
                </GridItem>

                {/* Right sidebar — same floating-card treatment as EpicDetailPage/TaskDetailForm. */}
                <GridItem>
                  <Box {...sidebarPanelProps} p={6}>
                    <VStack align="stretch" spacing={5}>
                      <Box>
                        <Text {...SECTION_LABEL_PROPS} mb={2}>
                          Status
                        </Text>
                        <HStack spacing={2}>
                          <Box w="8px" h="8px" borderRadius="full" bg={sm.color} flexShrink={0} />
                          <Text fontSize="sm" color="neutral.700">
                            {sm.label}
                          </Text>
                        </HStack>
                        <Text fontSize="xs" color="neutral.400" mt={1}>
                          Derived automatically from the dates below.
                        </Text>
                      </Box>

                      <Box>
                        <Text {...SECTION_LABEL_PROPS} mb={2}>
                          Dates
                        </Text>
                        {canManage ? (
                          <VStack align="stretch" spacing={2}>
                            <Input
                              type="date"
                              value={isoToDateInput(draft.start_date)}
                              onChange={(e) => handleStartDateChange(e.target.value)}
                              {...cardFieldProps}
                            />
                            <Input
                              type="date"
                              value={isoToDateInput(draft.end_date)}
                              onChange={(e) => handleEndDateChange(e.target.value)}
                              {...cardFieldProps}
                            />
                          </VStack>
                        ) : (
                          <Text fontSize="sm" color="neutral.700">
                            {new Date(draft.start_date).toLocaleDateString()}
                            {" → "}
                            {new Date(draft.end_date).toLocaleDateString()}
                          </Text>
                        )}
                      </Box>

                      <Box>
                        <Text {...SECTION_LABEL_PROPS} mb={2}>
                          Scope
                        </Text>
                        <Progress
                          value={draft.total_hours ? (draft.completed_hours / draft.total_hours) * 100 : 0}
                          size="sm"
                          borderRadius="full"
                          colorScheme="brand"
                          bg="neutral.100"
                          mb={2}
                        />
                        <Text fontSize="sm" color="neutral.700">
                          {formatDuration(draft.completed_hours)} of {formatDuration(draft.total_hours)} done
                        </Text>
                      </Box>

                      <Box pt={4} borderTop="1px solid" borderColor="rgba(229,231,235,0.6)">
                        <Text fontSize="xs" color="neutral.500">
                          Created by {creator?.emp_name || draft.created_by || "—"}
                          {draft.created_at ? ` on ${new Date(draft.created_at).toLocaleDateString()}` : ""}
                        </Text>
                      </Box>
                    </VStack>
                  </Box>
                </GridItem>
              </Grid>
            </Box>
          </>
        )}
      </Box>
    </SimpleLayout>
  );
};

export default SprintDetailPage;
