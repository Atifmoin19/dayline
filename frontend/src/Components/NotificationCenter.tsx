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
  Portal,
  Flex,
  Text,
  Button,
  VStack,
  useDisclosure,
} from "@chakra-ui/react";
import { FaRegBell } from "Utils/icons";
import {
  useNotificationsQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
} from "Services/user.api";
import { useAppSelector } from "app/hooks";
import { usePendingTasks } from "hooks/usePendingTasks";
import { usePushNotifications } from "hooks/usePushNotifications";
import { getPriorityColor } from "Utils/priority";
import PendingTasksModal from "./PendingTasksModal";

const timeAgo = (iso?: string) => {
  if (!iso) return "";
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return new Date(iso).toLocaleDateString();
};

const SectionHeader: React.FC<{ label: string; action?: React.ReactNode }> = ({ label, action }) => (
  <Flex
    justify="space-between"
    align="center"
    px={4}
    py={2}
    bg="neutral.50"
    borderY="1px solid"
    borderColor="surface.border"
  >
    <Text fontSize="xs" fontWeight={700} color="neutral.500" textTransform="uppercase" letterSpacing="0.04em">
      {label}
    </Text>
    {action}
  </Flex>
);

/**
 * Single header bell combining both alert streams:
 *   Row 1 — Notifications (in-app, mark-read)
 *   Row 2 — Task reminders (actionable backlog/todo/on-hold today)
 * with a "View all" that opens the full reminders modal. Replaces the two separate bells.
 */
const NotificationCenter: React.FC = () => {
  const { currentUser } = useAppSelector((state) => state.scheduler);
  const { data } = useNotificationsQuery(undefined, {
    skip: !currentUser,
    pollingInterval: 60000,
  });
  const [markRead] = useMarkNotificationReadMutation();
  const [markAllRead] = useMarkAllNotificationsReadMutation();
  const pending = usePendingTasks();
  const { isOpen: modalOpen, onOpen: openModal, onClose: closeModal } = useDisclosure();
  const push = usePushNotifications();

  const notifications = data?.items || [];
  const unread = data?.unread || 0;
  const totalBadge = unread + pending.length;

  // Auto-open the reminders modal once per session when there's actionable work.
  React.useEffect(() => {
    const shown = sessionStorage.getItem("pendingModalShown");
    if (currentUser && pending.length > 0 && !shown) {
      openModal();
      sessionStorage.setItem("pendingModalShown", "true");
    }
  }, [currentUser, pending.length, openModal]);

  return (
    <>
      <Popover placement="bottom-end" isLazy>
        <Box position="relative">
          <PopoverTrigger>
            <IconButton aria-label="Notifications" icon={<FaRegBell />} variant="ghost" colorScheme="gray" />
          </PopoverTrigger>
          {totalBadge > 0 && (
            <Badge
              position="absolute"
              top="0"
              right="0"
              colorScheme="red"
              borderRadius="full"
              fontSize="0.7em"
              px={1.5}
              pointerEvents="none"
            >
              {totalBadge}
            </Badge>
          )}
        </Box>
        <Portal>
          <PopoverContent width="380px" boxShadow="2xl" borderRadius="xl" overflow="hidden">
            <PopoverArrow />
            <PopoverBody p={0} maxH="460px" overflowY="auto">
              {/* Row 1 — Notifications */}
              <SectionHeader
                label="Notifications"
                action={
                  unread > 0 ? (
                    <Button size="xs" variant="link" colorScheme="blue" onClick={() => markAllRead()}>
                      Mark all read
                    </Button>
                  ) : undefined
                }
              />
              {notifications.length === 0 ? (
                <Text fontSize="sm" color="neutral.500" p={4} textAlign="center">
                  You're all caught up.
                </Text>
              ) : (
                <VStack align="stretch" spacing={0}>
                  {notifications.slice(0, 5).map((n) => (
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
                      _hover={{ bg: n.is_read ? "neutral.50" : "blue.100" }}
                      onClick={() => {
                        if (!n.is_read) markRead(n.id);
                      }}
                    >
                      {!n.is_read && (
                        <Box w="8px" h="8px" borderRadius="full" bg="blue.500" mt={1.5} flexShrink={0} />
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

              {/* Row 2 — Task reminders */}
              <SectionHeader
                label={`Task reminders${pending.length ? ` (${pending.length})` : ""}`}
                action={
                  pending.length > 0 ? (
                    <Button size="xs" variant="link" colorScheme="blue" onClick={openModal}>
                      View all
                    </Button>
                  ) : undefined
                }
              />
              {pending.length === 0 ? (
                <Text fontSize="sm" color="neutral.500" p={4} textAlign="center">
                  No tasks waiting.
                </Text>
              ) : (
                <VStack align="stretch" spacing={0}>
                  {pending.slice(0, 4).map((t) => (
                    <Flex
                      key={t.id}
                      px={4}
                      py={3}
                      gap={3}
                      align="center"
                      borderBottom="1px solid"
                      borderColor="surface.border"
                      cursor="pointer"
                      role="button"
                      tabIndex={0}
                      _hover={{ bg: "neutral.50" }}
                      onClick={openModal}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openModal();
                        }
                      }}
                      _focusVisible={{ outline: "2px solid", outlineColor: "blue.400", outlineOffset: "-2px" }}
                    >
                      <Badge colorScheme={getPriorityColor(t.task_priority)} fontSize="0.65em">
                        {t.task_priority || "P2"}
                      </Badge>
                      <Box flex={1} minW={0}>
                        <Text fontSize="sm" color="neutral.800" noOfLines={1}>
                          {t.task_name}
                        </Text>
                        <Text fontSize="xs" color="neutral.500" textTransform="capitalize">
                          {t.task_status}
                        </Text>
                      </Box>
                    </Flex>
                  ))}
                  {pending.length > 4 && (
                    <Button variant="ghost" size="sm" borderRadius={0} py={3} onClick={openModal}>
                      View all {pending.length} reminders
                    </Button>
                  )}
                </VStack>
              )}

              {/* Row 3 — Browser push toggle (only if the browser supports it) */}
              {push.supported && push.permission !== "denied" && (
                <Flex
                  px={4}
                  py={2.5}
                  gap={2}
                  align="center"
                  justify="space-between"
                  borderTop="1px solid"
                  borderColor="surface.border"
                  bg="neutral.50"
                >
                  <Text fontSize="xs" color="neutral.500">
                    Browser alerts
                  </Text>
                  <Button
                    size="xs"
                    variant="link"
                    colorScheme="blue"
                    onClick={() => (push.subscribed ? push.disable() : push.enable())}
                  >
                    {push.subscribed ? "Disable" : "Enable"}
                  </Button>
                </Flex>
              )}
            </PopoverBody>
          </PopoverContent>
        </Portal>
      </Popover>

      <PendingTasksModal isOpen={modalOpen} onClose={closeModal} />
    </>
  );
};

export default NotificationCenter;
