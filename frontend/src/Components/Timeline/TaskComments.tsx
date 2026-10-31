import React from "react";
import {
  Box,
  Flex,
  Text,
  Textarea,
  Button,
  VStack,
  HStack,
  Avatar,
  IconButton,
  Icon,
  Spinner,
  useToast,
} from "@chakra-ui/react";
import { FaTrash, FaHistory } from "Utils/icons";
import {
  useTaskCommentsQuery,
  useAddCommentMutation,
  useDeleteCommentMutation,
} from "Services/user.api";
import { useAppSelector } from "app/hooks";
import { avatarColor } from "Utils/avatar";

const timeAgo = (iso?: string) => {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const secs = Math.max(0, (Date.now() - then) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
};

const TaskComments: React.FC<{ taskId: string }> = ({ taskId }) => {
  const toast = useToast();
  const { currentUser } = useAppSelector((state) => state.scheduler);
  const { data: comments = [], isLoading } = useTaskCommentsQuery(taskId, {
    skip: !taskId,
  });
  const [addComment, { isLoading: adding }] = useAddCommentMutation();
  const [deleteComment] = useDeleteCommentMutation();
  const [body, setBody] = React.useState("");

  const submit = async () => {
    const text = body.trim();
    if (!text) return;
    try {
      await addComment({ taskId, body: text }).unwrap();
      setBody("");
    } catch {
      toast({ title: "Failed to add comment", status: "error" });
    }
  };

  const remove = async (id: number) => {
    try {
      await deleteComment({ id, taskId }).unwrap();
    } catch {
      toast({ title: "Failed to delete comment", status: "error" });
    }
  };

  return (
    <Box>
      <Text
        fontSize="sm"
        fontWeight={700}
        color="neutral.500"
        textTransform="uppercase"
        letterSpacing="0.04em"
        mb={3}
      >
        Comments & Activity
      </Text>

      {isLoading ? (
        <Flex justify="center" py={4}>
          <Spinner size="sm" />
        </Flex>
      ) : comments.length === 0 ? (
        <Text fontSize="sm" color="neutral.500" mb={3}>
          No comments yet.
        </Text>
      ) : (
        <VStack align="stretch" spacing={3} mb={4} maxH="260px" overflowY="auto">
          {comments.map((c) =>
            c.is_system ? (
              <Flex key={c.id} align="center" gap={2} pl={1}>
                <Icon as={FaHistory} color="neutral.500" boxSize="11px" />
                <Text fontSize="xs" color="neutral.500">
                  {c.body}
                  <Text as="span" color="neutral.500" ml={2}>
                    · {timeAgo(c.created_at)}
                  </Text>
                </Text>
              </Flex>
            ) : (
              <Flex key={c.id} gap={2.5} align="start">
                <Avatar
                  size="xs"
                  name={c.author_name || c.author_id}
                  bg={avatarColor(c.author_name || c.author_id)}
                  color="white"
                  mt={0.5}
                />
                <Box
                  flex={1}
                  bg="neutral.50"
                  borderRadius="md"
                  px={3}
                  py={2}
                  border="1px solid"
                  borderColor="surface.border"
                >
                  <Flex justify="space-between" align="center" mb={0.5}>
                    <HStack spacing={2}>
                      <Text fontSize="xs" fontWeight={700} color="neutral.800">
                        {c.author_name || c.author_id}
                      </Text>
                      <Text fontSize="xs" color="neutral.500">
                        {timeAgo(c.created_at)}
                      </Text>
                    </HStack>
                    {(c.author_id === currentUser?.emp_id) && (
                      <IconButton
                        aria-label="Delete comment"
                        icon={<FaTrash />}
                        size="xs"
                        variant="ghost"
                        colorScheme="red"
                        onClick={() => remove(c.id)}
                      />
                    )}
                  </Flex>
                  <Text fontSize="sm" color="neutral.700" whiteSpace="pre-wrap">
                    {c.body}
                  </Text>
                </Box>
              </Flex>
            ),
          )}
        </VStack>
      )}

      <HStack align="end" spacing={2}>
        <Textarea
          placeholder="Add a comment…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          size="sm"
          rows={2}
          resize="none"
          borderRadius="md"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
          }}
        />
        <Button
          size="sm"
          colorScheme="blue"
          onClick={submit}
          isLoading={adding}
          isDisabled={!body.trim()}
        >
          Post
        </Button>
      </HStack>
    </Box>
  );
};

export default TaskComments;
