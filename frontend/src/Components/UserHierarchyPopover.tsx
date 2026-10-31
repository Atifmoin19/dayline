import React, { useMemo } from "react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverBody,
  PopoverArrow,
  Portal,
  VStack,
  Text,
  HStack,
  Box,
  Divider,
  Badge,
} from "@chakra-ui/react";
import { useAppSelector } from "app/hooks";
import { Employee } from "types";
import UserAvatar from "Components/UserAvatar";

interface UserHierarchyPopoverProps {
  user: Employee;
  children: React.ReactNode; // The trigger (Avatar)
}

export const UserHierarchyPopover: React.FC<UserHierarchyPopoverProps> = ({
  user,
  children,
}) => {
  const { developers: allDevelopers, currentUser } = useAppSelector(
    (state) => state.scheduler
  );

  const { manager, reportees } = useMemo(() => {
    let manager = user.manager_id
      ? allDevelopers.find(
          (d) =>
            d.emp_id?.toLowerCase().trim() ===
            user.manager_id?.toLowerCase().trim()
        )
      : undefined;

    if (
      !manager &&
      user.manager_id &&
      currentUser?.emp_id?.toLowerCase().trim() ===
        user.manager_id?.toLowerCase().trim()
    ) {
      manager = currentUser;
    }

    const reportees = allDevelopers.filter(
      (d) =>
        d.manager_id?.toLowerCase().trim() === user.emp_id?.toLowerCase().trim()
    );
    return { manager, reportees };
  }, [allDevelopers, user, currentUser]);

  return (
    <Popover trigger="hover" placement="right-start" isLazy>
      <PopoverTrigger>{children}</PopoverTrigger>
      <Portal>
        <PopoverContent width="300px" boxShadow="xl" borderRadius="lg">
          <PopoverArrow />
          <PopoverBody p={4}>
            <VStack align="stretch" spacing={3}>
              {/* User Header */}
              <HStack spacing={3}>
                <UserAvatar size="md" name={user.emp_name} photo={user.profile_pic} />
                <Box>
                  <Text fontWeight="bold" fontSize="md">
                    {user.emp_name}
                  </Text>
                  <HStack spacing={1}>
                    <Badge colorScheme="blue" variant="subtle">
                      {user.emp_designation}
                    </Badge>
                    <Text fontSize="xs" color="gray.600">
                      {user.emp_id}
                    </Text>
                  </HStack>
                </Box>
              </HStack>

              <Divider />

              {/* Manager Section */}
              <Box>
                <Text
                  fontSize="xs"
                  fontWeight="bold"
                  textTransform="uppercase"
                  color="gray.600"
                  mb={1}
                >
                  Reports To
                </Text>
                {manager ? (
                  <HStack spacing={2}>
                    <UserAvatar size="xs" name={manager.emp_name} photo={manager.profile_pic} />
                    <Box>
                      <Text fontSize="sm" fontWeight="medium">
                        {manager.emp_name}
                      </Text>
                      <Text fontSize="xs" color="gray.600">
                        {manager.emp_designation}
                      </Text>
                    </Box>
                  </HStack>
                ) : (
                  <Text fontSize="sm" color="gray.600" fontStyle="italic">
                    No Manager Assigned (Top Level)
                  </Text>
                )}
              </Box>

              {/* Reportees Section - Only if they have reportees */}
              {reportees.length > 0 && (
                <Box>
                  <Divider mb={2} />
                  <Text
                    fontSize="xs"
                    fontWeight="bold"
                    textTransform="uppercase"
                    color="gray.600"
                    mb={1}
                  >
                    Direct Reports ({reportees.length})
                  </Text>
                  <VStack
                    align="stretch"
                    spacing={2}
                    maxH="150px"
                    overflowY="auto"
                  >
                    {reportees.map((rep) => (
                      <HStack key={rep.emp_id} spacing={2}>
                        <UserAvatar size="xs" name={rep.emp_name} photo={rep.profile_pic} />
                        <Box>
                          <Text fontSize="sm">{rep.emp_name}</Text>
                          <Text fontSize="xs" color="gray.600">
                            {rep.emp_designation}
                          </Text>
                        </Box>
                      </HStack>
                    ))}
                  </VStack>
                </Box>
              )}
            </VStack>
          </PopoverBody>
        </PopoverContent>
      </Portal>
    </Popover>
  );
};
