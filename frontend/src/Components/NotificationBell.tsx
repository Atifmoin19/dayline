import React from "react";
import {
  Box,
  Badge,
  IconButton,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverArrow,
  PopoverBody,
  PopoverHeader,
  Portal,
  Flex,
  Text,
  Button,
  VStack,
} from "@chakra-ui/react";
import { FaRegBell } from "Utils/icons";
import {
  useNotificationsQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
} from "Services/user.api";
import { useAppSelector } from "app/hooks";

const timeAgo = (iso?: string) => {
  if (!iso) return "";
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return new Date(iso).toLocaleDateString();
};

const NotificationBell: React.FC = () => {
  const { currentUser } = useAppSelector((state) => state.scheduler);
  const { data } = useNotificationsQuery(undefined, {
    skip: !currentUser,
    pollingInterval: 60000,
  });
  const [markRead] = useMarkNotificationReadMutation();
  const [markAllRead] = useMarkAllNotificationsReadMutation();

  const items = data?.items || [];
  const unread = data?.unread || 0;

  return (
    <Popover placement="bottom-end" isLazy>
      <Box position="relative">
        <PopoverTrigger>
          <IconButton
            aria-label="Notifications"
            icon={<FaRegBell />}
            variant="ghost"
            colorScheme="gray"
          />
        </PopoverTrigger>
        {unread > 0 && (
          <Badge
            position="absolute"
            top="0"
            right="0"
            colorScheme="blue"
            borderRadius="full"
            fontSize="0.7em"
            px={1.5}
            pointerEvents="none"
          >
            {unread}
          </Badge>
        )}
      </Box>
      <Portal>
        <PopoverContent width="360px" boxShadow="2xl" borderRadius="xl" overflow="hidden">
          <PopoverArrow />
          <PopoverHeader>
            <Flex justify="space-between" align="center">
              <Text fontWeight={700} fontSize="sm">
                Notifications
              </Text>
              {unread > 0 && (
                <Button size="xs" variant="link" colorScheme="blue" onClick={() => markAllRead()}>
                  Mark all read
                </Button>
              )}
            </Flex>
          </PopoverHeader>
          <PopoverBody p={0} maxH="360px" overflowY="auto">
            {items.length === 0 ? (
              <Text fontSize="sm" color="neutral.500" p={4} textAlign="center">
                You're all caught up.
              </Text>
            ) : (
              <VStack align="stretch" spacing={0}>
                {items.map((n) => (
                  <Flex
                    key={n.id}
                    px={4}
                    py={3}
                    gap={3}
                    align="start"
                    borderBottom="1px solid"
                    borderColor="surface.border"
                    bg={n.is_read ? "transparent" : "blue.50"}
                    cursor={n.is_read ? "default" : "pointer"}
                    role={n.is_read ? undefined : "button"}
                    tabIndex={n.is_read ? undefined : 0}
                    _hover={{ bg: n.is_read ? "neutral.50" : "blue.100" }}
                    onClick={() => {
                      if (!n.is_read) markRead(n.id);
                    }}
                    onKeyDown={(e) => {
                      if (!n.is_read && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        markRead(n.id);
                      }
                    }}
                    _focusVisible={n.is_read ? undefined : { outline: "2px solid", outlineColor: "blue.400", outlineOffset: "-2px" }}
                  >
                    {!n.is_read && (
                      <Box
                        w="8px"
                        h="8px"
                        borderRadius="full"
                        bg="blue.500"
                        mt={1.5}
                        flexShrink={0}
                      />
                    )}
                    <Box flex={1} pl={n.is_read ? "16px" : 0}>
                      <Text fontSize="sm" color="neutral.800">
                        {n.message}
                      </Text>
                      <Text fontSize="xs" color="neutral.500" mt={0.5}>
                        {timeAgo(n.created_at)}
                      </Text>
                    </Box>
                  </Flex>
                ))}
              </VStack>
            )}
          </PopoverBody>
        </PopoverContent>
      </Portal>
    </Popover>
  );
};

export default NotificationBell;
