import React, { useEffect } from "react";
import { Box, Flex, Text, Button, Spinner } from "@chakra-ui/react";
import { useNavigate, useParams } from "react-router-dom";
import SimpleLayout from "Layouts/simpleLayout";
import TaskDetailForm from "Components/Timeline/TaskDetailForm";
import { useAppDispatch, useAppSelector } from "app/hooks";
import { addTask } from "app/slices/scheduler.slice";
import { useTaskListQuery } from "Services/user.api";
import { FaChevronLeft } from "Utils/icons";

/** Full-page counterpart to `TaskDetailModal` (same `TaskDetailForm`, sidebar/header chrome
 * kept via `SimpleLayout`) — reached via the modal's "maximize" icon or a direct /tasks/:id
 * link (e.g. a copied task link, or an email/notification deep link). */
const TaskDetailPage: React.FC = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { tasks, currentUser } = useAppSelector((state) => state.scheduler);
  const task = tasks.find((t) => t.id === taskId);

  // Direct navigation (e.g. a pasted link) may land here before the dashboard has ever
  // fetched tasks into Redux — fetch once as a safety net if the task isn't already loaded.
  const { data: taskData, isFetching } = useTaskListQuery(
    {},
    { skip: !currentUser || !!task },
  );
  useEffect(() => {
    if (taskData) {
      dispatch(
        addTask(Array.isArray(taskData) ? taskData : (taskData.items ?? [])),
      );
    }
  }, [taskData, dispatch]);

  return (
    <SimpleLayout>
      <Box mb={4}>
        <Button
          leftIcon={<FaChevronLeft />}
          variant="ghost"
          size="sm"
          onClick={() => navigate(-1)}
        >
          Back
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
        {task ? (
          <TaskDetailForm task={task} />
        ) : isFetching ? (
          <Flex
            align="center"
            justify="center"
            h="100%"
            direction="column"
            gap={3}
          >
            <Spinner />
            <Text color="neutral.500" fontSize="sm">
              Loading task…
            </Text>
          </Flex>
        ) : (
          <Flex
            align="center"
            justify="center"
            h="100%"
            direction="column"
            gap={2}
          >
            <Text color="neutral.700" fontWeight={600}>
              Task not found
            </Text>
            <Text color="neutral.500" fontSize="sm">
              It may have been deleted, or you don't have access to it.
            </Text>
          </Flex>
        )}
      </Box>
    </SimpleLayout>
  );
};

export default TaskDetailPage;
