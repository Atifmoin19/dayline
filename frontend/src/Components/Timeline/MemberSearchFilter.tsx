import React, { useMemo, useState } from "react";
import {
  Box,
  Button,
  Flex,
  Input,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Text,
  Wrap,
  WrapItem,
} from "@chakra-ui/react";
import { FaCheck, FaChevronDown, FaSearch, FaTimes } from "Utils/icons";
import UserAvatar from "Components/UserAvatar";
import { Employee } from "types";

interface MemberSearchFilterProps {
  /** The pool to search over — the view's already org-tree-scoped member set, so this narrows
   *  which rows are visible further, rather than replacing org-tree scoping. */
  members: Employee[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
}

/**
 * Typeahead member filter for Timeline/Week (scale-gaps-plan.md §B.1) — narrows which member
 * ROWS are visible in the grid, on top of (not instead of) org-tree scoping + the "All Members"
 * manager dropdown. Modeled on `AssigneePicker`'s searchable-combobox UX (avatar + name +
 * designation, filter-as-you-type), but deliberately a separate component: `AssigneePicker`'s
 * `onChange` contract sets a single task's assignee, while this filters a list of rows and
 * supports selecting more than one person (a cross-functional team, not one assignee).
 */
const MemberSearchFilter: React.FC<MemberSearchFilterProps> = ({
  members,
  selectedIds,
  onChange,
  placeholder = "Search people…",
}) => {
  const [search, setSearch] = useState("");
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (d) =>
        d.emp_name?.toLowerCase().includes(q) ||
        d.emp_designation?.toLowerCase().includes(q) ||
        d.emp_department?.toLowerCase().includes(q),
    );
  }, [members, search]);

  const selectedMembers = useMemo(
    () => members.filter((d) => selectedSet.has(d.emp_id)),
    [members, selectedSet],
  );

  const toggle = (empId: string) => {
    if (selectedSet.has(empId)) onChange(selectedIds.filter((id) => id !== empId));
    else onChange([...selectedIds, empId]);
  };

  return (
    <Flex align="center" gap={2} wrap="wrap">
      <Menu closeOnSelect={false} isLazy matchWidth>
        <MenuButton as={Button} size="sm" variant="outline" borderRadius="md" minW="190px">
          <Flex align="center" gap={2}>
            <Box as={FaSearch} boxSize="11px" color="neutral.500" flexShrink={0} />
            <Text fontSize="sm" fontWeight={500} noOfLines={1} flex={1} textAlign="left">
              {selectedMembers.length === 0 ? "All members" : `${selectedMembers.length} selected`}
            </Text>
            <Box as={FaChevronDown} color="neutral.500" boxSize="10px" flexShrink={0} />
          </Flex>
        </MenuButton>
        <MenuList maxH="340px" overflowY="auto" p={2} minW="280px">
          <Box px={2} pb={2}>
            <Input
              size="sm"
              placeholder={placeholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                // Swallow plain character keys so they don't also trigger Chakra Menu's built-in
                // type-ahead (which would jump focus based on the letter typed), but let
                // ArrowDown/ArrowUp/Enter/Escape bubble up so keyboard users can still
                // navigate/select/close while the search box has focus.
                if (!["ArrowDown", "ArrowUp", "Escape", "Enter", "Tab"].includes(e.key)) {
                  e.stopPropagation();
                }
              }}
              autoFocus
            />
          </Box>
          {filtered.length === 0 && (
            <Text fontSize="sm" color="neutral.500" px={2} py={1}>
              No matches.
            </Text>
          )}
          {filtered.map((dev) => {
            const isSelected = selectedSet.has(dev.emp_id);
            return (
              <MenuItem
                key={dev.emp_id}
                onClick={() => toggle(dev.emp_id)}
                closeOnSelect={false}
                borderRadius="md"
                px={2}
                py={2}
                bg={isSelected ? "brand.50" : undefined}
              >
                <Flex align="center" gap={3} width="100%">
                  <UserAvatar size="sm" name={dev.emp_name} photo={dev.profile_pic} />
                  <Box flex={1} minW={0}>
                    <Text fontSize="sm" fontWeight={500} noOfLines={1}>
                      {dev.emp_name}
                    </Text>
                    <Text fontSize="xs" color="neutral.500" noOfLines={1}>
                      {dev.emp_designation}
                    </Text>
                  </Box>
                  {isSelected && (
                    <Box as={FaCheck} color="brand.600" boxSize="12px" flexShrink={0} />
                  )}
                </Flex>
              </MenuItem>
            );
          })}
        </MenuList>
      </Menu>

      {selectedMembers.length > 0 && (
        <Wrap spacing={1} align="center">
          {selectedMembers.map((d) => (
            <WrapItem key={d.emp_id}>
              <Flex align="center" gap={1} pl={2} pr={1} py="2px" borderRadius="full" bg="neutral.100">
                <Text fontSize="xs" fontWeight={600} color="neutral.700">
                  {d.emp_name}
                </Text>
                <Box
                  as="button"
                  type="button"
                  aria-label={`Remove ${d.emp_name}`}
                  onClick={() => toggle(d.emp_id)}
                  display="flex"
                  alignItems="center"
                  color="neutral.500"
                  _hover={{ color: "neutral.800" }}
                >
                  <Box as={FaTimes} boxSize="9px" />
                </Box>
              </Flex>
            </WrapItem>
          ))}
          <Button size="xs" variant="link" onClick={() => onChange([])} color="neutral.500">
            Clear
          </Button>
        </Wrap>
      )}
    </Flex>
  );
};

export default MemberSearchFilter;
