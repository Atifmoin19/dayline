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
} from "@chakra-ui/react";
import { FaChevronDown, FaUserCircle } from "Utils/icons";
import UserAvatar from "Components/UserAvatar";
import { Employee } from "types";

interface AssigneePickerProps {
  value?: string; // emp_id
  onChange: (empId: string) => void;
  developers: Employee[];
  isDisabled?: boolean;
  placeholder?: string;
  size?: "md" | "sm"; // "sm" shrinks padding/avatar for use inline in a table row
}

/**
 * Searchable assignee combobox — replaces the plain `<Select>` now that assignment is open
 * to the entire org directory (potentially dozens of names), not just self/subordinates.
 */
const AssigneePicker: React.FC<AssigneePickerProps> = ({
  value,
  onChange,
  developers,
  isDisabled,
  placeholder = "Unassigned",
  size = "md",
}) => {
  const isCompact = size === "sm";
  const [search, setSearch] = useState("");

  const selected = useMemo(
    () => developers?.find((d) => d.emp_id === value),
    [developers, value],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = developers || [];
    if (!q) return list;
    return list.filter(
      (d) =>
        d.emp_name?.toLowerCase().includes(q) ||
        d.emp_designation?.toLowerCase().includes(q),
    );
  }, [developers, search]);

  return (
    <Menu isLazy matchWidth closeOnSelect>
      {({ onClose }) => (
        <>
          <MenuButton
            as={Button}
            variant="unstyled"
            width="100%"
            display="flex"
            alignItems="center"
            justifyContent="space-between"
            fontWeight={500}
            isDisabled={isDisabled}
            bg="white"
            border="1px solid"
            borderColor="surface.border"
            borderRadius={isCompact ? "0.5rem" : "0.75rem"}
            boxShadow={isCompact ? "none" : "sm"}
            px={isCompact ? 2 : 4}
            py={isCompact ? 1 : 3}
            h="auto"
            _hover={{ borderColor: "neutral.300" }}
          >
            <Flex align="center" justify="space-between" gap={2} w="100%" minW={0}>
              {selected ? (
                <Flex align="center" gap={isCompact ? 2 : 3} flex={1} minW={0}>
                  <UserAvatar
                    size={isCompact ? "xs" : "sm"}
                    name={selected.emp_name}
                    photo={selected.profile_pic}
                    border="1px solid"
                    borderColor="neutral.200"
                  />
                  <Text fontSize="sm" fontWeight={500} noOfLines={1} minW={0}>
                    {selected.emp_name}
                  </Text>
                </Flex>
              ) : (
                <Flex align="center" gap={2} color="neutral.500" flex={1} minW={0}>
                  <Box as={FaUserCircle} />
                  <Text fontSize="sm" noOfLines={1}>{placeholder}</Text>
                </Flex>
              )}
              <Box as={FaChevronDown} color="neutral.500" flexShrink={0} boxSize={isCompact ? "10px" : undefined} />
            </Flex>
          </MenuButton>
          <MenuList maxH="320px" overflowY="auto" p={2} minW="280px">
            <Box px={3} pb={2}>
              <Input
                size="sm"
                placeholder="Search people..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  // Swallow plain character keys so they don't also trigger Chakra Menu's
                  // built-in type-ahead (which would jump focus based on the letter typed),
                  // but let ArrowDown/ArrowUp/Enter/Escape bubble up to <MenuList> so
                  // keyboard users can still navigate/select/close while the search box
                  // has focus.
                  if (!["ArrowDown", "ArrowUp", "Escape", "Enter", "Tab"].includes(e.key)) {
                    e.stopPropagation();
                  }
                }}
                autoFocus
              />
            </Box>
            {filtered.length === 0 && (
              <Text fontSize="sm" color="neutral.500" px={3} py={1}>
                No matches.
              </Text>
            )}
            {filtered.map((dev) => (
              <MenuItem
                key={dev.emp_id}
                onClick={() => {
                  onChange(dev.emp_id);
                  setSearch("");
                  onClose();
                }}
                borderRadius="md"
                px={3}
                py={2}
                bg={dev.emp_id === value ? "brand.50" : undefined}
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
                </Flex>
              </MenuItem>
            ))}
          </MenuList>
        </>
      )}
    </Menu>
  );
};

export default AssigneePicker;
