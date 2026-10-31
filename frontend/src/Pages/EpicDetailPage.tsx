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
  Textarea,
  Select,
  Progress,
  HStack,
  VStack,
  Spinner,
  useToast,
} from "@chakra-ui/react";
import SimpleLayout from "Layouts/simpleLayout";
import { useAppSelector } from "app/hooks";
import { useTaskDetail } from "Contexts/useTaskDetail";
import { useGetEpicQuery, useUpdateEpicMutation, useDeleteEpicMutation } from "Services/user.api";
import { getApiErrorMessage } from "Services/baseQuery";
import { Epic, EpicCreatePayload } from "types";
import { ADMIN_ROLES, SUPER_ADMIN_ROLES } from "Utils/constants";
import { FaChevronLeft, FaTrash, FaBookmark, FaUserCircle } from "Utils/icons";
import UserAvatar from "Components/UserAvatar";
import AssigneePicker from "Components/Timeline/AssigneePicker";
import { getPriorityColor } from "Utils/priority";
import { EPIC_STATUS_OPTIONS, epicStatusMeta } from "Utils/epicStatus";
import {
  LABEL_PROPS as SECTION_LABEL_PROPS,
  cardFieldProps,
  softFieldProps,
  sidebarPanelProps,
} from "Components/Timeline/taskModalStyles";

// yyyy-mm-dd for a native <input type="date">; "" when unset so the input shows empty rather
// than "Invalid Date".
const isoToDateInput = (iso?: string): string => (iso ? iso.slice(0, 10) : "");

// End-of-day for target_date (so "today" as a target reads as still-in-progress until it's
// actually over) vs. start-of-day for start_date; undefined (not "") clears the field, since
// saveField's EpicCreatePayload only distinguishes "provided" from "omitted".
const dateInputToIso = (value: string, endOfDay: boolean): string | undefined =>
  value ? new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}`).toISOString() : undefined;

/**
 * Epic detail/edit page — a full route (`/epics/:epicId`) rather than a modal, since epics are
 * only ever opened from the list page (unlike tasks, which are opened from many contexts and so
 * need the modal + "maximize to page" pattern). Structured fields autosave on change, same
 * convention as `TaskDetailForm`'s sidebar. Only the epic's owner, creator, or an admin can edit
 * or delete — enforced server-side, but hidden here too so non-permitted users don't hit a 403.
 */
const EpicDetailPage: React.FC = () => {
  const { epicId } = useParams<{ epicId: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { openTaskDetail } = useTaskDetail();
  const developers = useAppSelector((state) => state.scheduler.developers);
  const currentUser = useAppSelector((state) => state.scheduler.currentUser);

  const { data: epicData, isFetching, isError } = useGetEpicQuery(epicId ?? "", {
    skip: !epicId,
  });
  const [updateEpicApi] = useUpdateEpicMutation();
  const [deleteEpicApi, { isLoading: isDeleting }] = useDeleteEpicMutation();

  // Local editable copy, reseeded whenever a fresh server response lands — same "save on
  // change, server response is the source of truth" shape as TaskDetailForm's saveField,
  // just without a Redux slice to optimistically write through (epics aren't stored there).
  const [draft, setDraft] = useState<Epic | null>(null);
  useEffect(() => {
    if (epicData) setDraft(epicData);
  }, [epicData]);

  const saveField = async (patch: EpicCreatePayload) => {
    if (!draft) return;
    const previous = draft;
    setDraft({ ...draft, ...patch } as Epic);
    try {
      const resp = await updateEpicApi({ id: draft.id, ...patch }).unwrap();
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

  const handleDelete = async () => {
    if (!draft) return;
    if (!window.confirm(`Delete epic "${draft.name}"? Its linked stories will be detached, not deleted.`)) {
      return;
    }
    try {
      await deleteEpicApi(draft.id).unwrap();
      toast({ title: "Epic deleted", status: "success" });
      navigate("/epics");
    } catch (e) {
      toast({
        title: "Failed to delete epic",
        description: getApiErrorMessage(e),
        status: "error",
      });
    }
  };

  const isManagement =
    !!currentUser &&
    (ADMIN_ROLES.includes(currentUser.emp_designation) ||
      SUPER_ADMIN_ROLES.includes(currentUser.emp_designation));
  const canManage =
    !!currentUser &&
    !!draft &&
    (draft.owner_id === currentUser.emp_id ||
      draft.created_by === currentUser.emp_id ||
      isManagement);

  const owner = developers.find((d) => d.emp_id === draft?.owner_id);
  const creator = developers.find((d) => d.emp_id === draft?.created_by);
  const sm = epicStatusMeta(draft?.status);

  return (
    <SimpleLayout>
      <Box mb={4}>
        <Button leftIcon={<FaChevronLeft />} variant="ghost" size="sm" onClick={() => navigate("/epics")}>
          Back to Epics
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
              Loading epic…
            </Text>
          </Flex>
        ) : !draft || isError ? (
          <Flex align="center" justify="center" h="300px" direction="column" gap={2}>
            <Text color="neutral.700" fontWeight={600}>
              Epic not found
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
                  <Box as={FaBookmark} boxSize="10px" fill="currentColor" color="brand.600" />
                  <Text>{draft.ticket_id || `#${draft.id.slice(-6).toUpperCase()}`}</Text>
                </HStack>
                {canManage ? (
                  <Input
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    onBlur={(e) => {
                      if (e.target.value.trim() && e.target.value !== epicData?.name) {
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
                  aria-label="Delete epic"
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
                      <Text {...SECTION_LABEL_PROPS} mb={2}>
                        Description
                      </Text>
                      {canManage ? (
                        <Textarea
                          value={draft.description || ""}
                          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                          onBlur={(e) => {
                            if (e.target.value !== (epicData?.description || "")) {
                              saveField({ description: e.target.value });
                            }
                          }}
                          placeholder="What is this initiative about?"
                          rows={5}
                          {...softFieldProps}
                        />
                      ) : (
                        <Box border="1px solid" borderColor="surface.border" borderRadius="0.75rem" p={4}>
                          <Text fontSize="sm" color={draft.description ? "neutral.700" : "neutral.500"}>
                            {draft.description || "No description."}
                          </Text>
                        </Box>
                      )}
                    </Box>

                    <Box>
                      <Flex align="center" justify="space-between" mb={2}>
                        <Text {...SECTION_LABEL_PROPS}>
                          Stories ({draft.story_done}/{draft.story_total})
                        </Text>
                      </Flex>
                      {!!draft.story_total && (
                        <Progress
                          value={draft.progress_pct}
                          size="sm"
                          borderRadius="full"
                          colorScheme="brand"
                          bg="neutral.100"
                          mb={3}
                        />
                      )}
                      {!draft.stories || draft.stories.length === 0 ? (
                        <Text fontSize="sm" color="neutral.500">
                          No stories linked yet. Attach this epic from a task's Epic field.
                        </Text>
                      ) : (
                        <VStack align="stretch" spacing={2}>
                          {draft.stories.map((story) => {
                            const assignee = developers.find((d) => d.emp_id === story.task_assigned_to);
                            const isDone = ["done", "completed"].includes(
                              (story.task_status || "").toLowerCase(),
                            );
                            return (
                              <Flex
                                key={story.id}
                                as="button"
                                type="button"
                                onClick={() => openTaskDetail(story)}
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
                                  <Box as={FaBookmark} color="brand.600" boxSize="11px" flexShrink={0} fill="currentColor" />
                                  <Text fontSize="xs" color="neutral.500" flexShrink={0}>
                                    {story.ticket_id || `#${story.id.slice(-6).toUpperCase()}`}
                                  </Text>
                                  <Text
                                    fontSize="sm"
                                    fontWeight={600}
                                    color="neutral.900"
                                    textDecoration={isDone ? "line-through" : undefined}
                                    isTruncated
                                  >
                                    {story.task_name}
                                  </Text>
                                </Flex>
                                <Flex align="center" gap={2} flexShrink={0}>
                                  {story.task_priority && (
                                    <Badge colorScheme={getPriorityColor(story.task_priority)} fontSize="0.6rem">
                                      {story.task_priority}
                                    </Badge>
                                  )}
                                  <Text fontSize="xs" fontWeight={600} color="neutral.700" isTruncated maxW="110px">
                                    {assignee?.emp_name || story.task_assigned_to || "Unassigned"}
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

                {/* Right sidebar — same floating-card treatment as TaskDetailForm/TaskCreationModal. */}
                <GridItem>
                  <Box {...sidebarPanelProps} p={6}>
                    <VStack align="stretch" spacing={5}>
                      <Box>
                        <Flex align="center" gap={1.5} mb={2}>
                          <Box as={FaUserCircle} color="neutral.500" boxSize="12px" />
                          <Text {...SECTION_LABEL_PROPS}>Owner</Text>
                        </Flex>
                        {canManage ? (
                          <AssigneePicker
                            value={draft.owner_id}
                            onChange={(empId) => saveField({ owner_id: empId })}
                            developers={developers}
                          />
                        ) : owner ? (
                          <Flex align="center" gap={2}>
                            <UserAvatar size="sm" name={owner.emp_name} photo={owner.profile_pic} />
                            <Text fontSize="sm" fontWeight={500} color="neutral.800">
                              {owner.emp_name}
                            </Text>
                          </Flex>
                        ) : (
                          <Text fontSize="sm" color="neutral.500">
                            Unassigned
                          </Text>
                        )}
                      </Box>

                      <Box>
                        <Text {...SECTION_LABEL_PROPS} mb={2}>
                          Status
                        </Text>
                        {canManage ? (
                          <Select
                            value={draft.status || "todo"}
                            onChange={(e) => saveField({ status: e.target.value })}
                            {...cardFieldProps}
                          >
                            {EPIC_STATUS_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <HStack spacing={2}>
                            <Box w="8px" h="8px" borderRadius="full" bg={sm.color} flexShrink={0} />
                            <Text fontSize="sm" color="neutral.700">
                              {sm.label}
                            </Text>
                          </HStack>
                        )}
                      </Box>

                      <Box>
                        <Text {...SECTION_LABEL_PROPS} mb={2}>
                          Department
                        </Text>
                        {canManage ? (
                          <Input
                            value={draft.department || ""}
                            onChange={(e) => setDraft({ ...draft, department: e.target.value })}
                            onBlur={(e) => {
                              if (e.target.value !== (epicData?.department || "")) {
                                saveField({ department: e.target.value || undefined });
                              }
                            }}
                            placeholder="No department"
                            px={4}
                            {...cardFieldProps}
                          />
                        ) : draft.department ? (
                          <Badge colorScheme="gray" variant="subtle">
                            {draft.department}
                          </Badge>
                        ) : (
                          <Text fontSize="sm" color="neutral.400">
                            —
                          </Text>
                        )}
                      </Box>

                      <Box>
                        <Text {...SECTION_LABEL_PROPS} mb={2}>
                          Timeline
                        </Text>
                        {canManage ? (
                          <VStack align="stretch" spacing={2}>
                            <Input
                              type="date"
                              value={isoToDateInput(draft.start_date)}
                              onChange={(e) =>
                                saveField({ start_date: dateInputToIso(e.target.value, false) })
                              }
                              {...cardFieldProps}
                            />
                            <Input
                              type="date"
                              value={isoToDateInput(draft.target_date)}
                              onChange={(e) =>
                                saveField({ target_date: dateInputToIso(e.target.value, true) })
                              }
                              {...cardFieldProps}
                            />
                          </VStack>
                        ) : draft.start_date || draft.target_date ? (
                          <Text fontSize="sm" color="neutral.700">
                            {draft.start_date ? new Date(draft.start_date).toLocaleDateString() : "—"}
                            {" → "}
                            {draft.target_date ? new Date(draft.target_date).toLocaleDateString() : "—"}
                          </Text>
                        ) : (
                          <Text fontSize="sm" color="neutral.400">
                            No dates set
                          </Text>
                        )}
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

export default EpicDetailPage;
