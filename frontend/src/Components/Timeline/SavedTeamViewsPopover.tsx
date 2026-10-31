import React, { useState } from "react";
import {
  Box,
  Button,
  Flex,
  HStack,
  IconButton,
  Input,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Portal,
  Text,
  VStack,
} from "@chakra-ui/react";
import { FaBookmark, FaBookmarkPlus, FaTrash } from "Utils/icons";
import { useSavedViews } from "hooks/useSavedViews";
import { Employee } from "types";

interface SavedTeamViewsPopoverProps {
  empId?: string;
  /** The currently-selected member-filter ids (`MemberSearchFilter`) to save as a named view. */
  selectedMemberIds: string[];
  /** Applies a saved view's member ids back into the parent's member-filter state. */
  onApply: (memberIds: string[]) => void;
  /** Full directory, used only to resolve names for each saved view's summary line. */
  members: Employee[];
}

/**
 * Named "team view" presets for Timeline/Week (scale-gaps-plan.md §B.2) — saves the member
 * search-filter selection as a reusable cross-functional grouping ("these N people") that isn't
 * limited to an org-tree subtree. Reuses `useSavedViews`'s existing per-user localStorage
 * persistence under a distinct `"timeline"` namespace, so these don't mix into the Task List
 * toolbar's saved views (a different shape — search/statusFilter/priorityFilter — and purpose).
 * UI mirrors `TaskListingView`'s "Views" popover (same save/apply/delete pattern).
 */
const SavedTeamViewsPopover: React.FC<SavedTeamViewsPopoverProps> = ({
  empId,
  selectedMemberIds,
  onApply,
  members,
}) => {
  const { views, saveView, deleteView } = useSavedViews(empId, "timeline");
  const [newViewName, setNewViewName] = useState("");

  const nameFor = (id: string) => members.find((m) => m.emp_id === id)?.emp_name || id;

  const handleSave = () => {
    saveView(newViewName, {
      search: "",
      statusFilter: "all",
      priorityFilter: "all",
      memberIds: selectedMemberIds,
    });
    setNewViewName("");
  };

  return (
    <Popover placement="bottom-start" isLazy>
      <PopoverTrigger>
        <Button size="sm" variant="outline" leftIcon={<FaBookmark />} borderRadius="md">
          Team views{views.length > 0 ? ` (${views.length})` : ""}
        </Button>
      </PopoverTrigger>
      <Portal>
        <PopoverContent w="300px" boxShadow="xl" borderRadius="lg">
          <PopoverArrow />
          <PopoverBody>
            <Text fontSize="xs" fontWeight={700} color="neutral.500" textTransform="uppercase" mb={2}>
              Saved team views
            </Text>
            {views.length === 0 ? (
              <Text fontSize="sm" color="neutral.500" mb={3}>
                No saved team views yet.
              </Text>
            ) : (
              <VStack align="stretch" spacing={1} mb={3} maxH="220px" overflowY="auto">
                {views.map((v) => {
                  const ids = v.memberIds || [];
                  return (
                    <Flex
                      key={v.id}
                      align="center"
                      justify="space-between"
                      px={2}
                      py={1.5}
                      borderRadius="md"
                      cursor="pointer"
                      role="button"
                      tabIndex={0}
                      aria-label={`Apply team view ${v.name}`}
                      _hover={{ bg: "neutral.50" }}
                      onClick={() => onApply(ids)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onApply(ids);
                        }
                      }}
                      _focusVisible={{
                        outline: "2px solid",
                        outlineColor: "blue.400",
                        outlineOffset: "-2px",
                      }}
                    >
                      <Box minW={0} flex={1}>
                        <Text fontSize="sm" color="neutral.800" noOfLines={1}>
                          {v.name}
                        </Text>
                        <Text fontSize="xs" color="neutral.500" noOfLines={1}>
                          {ids.length} member{ids.length === 1 ? "" : "s"}
                          {ids.length > 0
                            ? ` · ${ids.slice(0, 3).map(nameFor).join(", ")}${ids.length > 3 ? "…" : ""}`
                            : ""}
                        </Text>
                      </Box>
                      <IconButton
                        aria-label={`Delete team view ${v.name}`}
                        icon={<FaTrash />}
                        size="xs"
                        variant="ghost"
                        colorScheme="red"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteView(v.id);
                        }}
                      />
                    </Flex>
                  );
                })}
              </VStack>
            )}

            <Text fontSize="xs" fontWeight={700} color="neutral.500" textTransform="uppercase" mb={2}>
              Save current selection
            </Text>
            <HStack>
              <Input
                size="sm"
                placeholder="e.g. Payments squad"
                value={newViewName}
                onChange={(e) => setNewViewName(e.target.value)}
                isDisabled={selectedMemberIds.length === 0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                }}
              />
              <IconButton
                aria-label="Save team view"
                icon={<FaBookmarkPlus />}
                size="sm"
                colorScheme="brand"
                isDisabled={selectedMemberIds.length === 0 || !newViewName.trim()}
                onClick={handleSave}
              />
            </HStack>
            {selectedMemberIds.length === 0 && (
              <Text fontSize="xs" color="neutral.500" mt={1.5}>
                Select members in the filter above, then save them as a team view.
              </Text>
            )}
          </PopoverBody>
        </PopoverContent>
      </Portal>
    </Popover>
  );
};

export default SavedTeamViewsPopover;
