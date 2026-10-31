import React, { useEffect, useState } from "react";
import {
  Box,
  Container,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  Heading,
  Button,
  Flex,
  HStack,
  Select,
} from "@chakra-ui/react";
import TaskListingView from "Components/Timeline/TaskListingView";
import SimpleLayout from "Layouts/simpleLayout";
import { Link, useNavigate } from "react-router-dom";
import { Task } from "types";
import { useTaskDetail } from "Contexts/useTaskDetail";
import { useTaskListQuery } from "Services/user.api";
import { useAppDispatch, useAppSelector } from "app/hooks";
import { addTask } from "app/slices/scheduler.slice";
import { ADMIN_ROLES, SUPER_ADMIN_ROLES } from "Utils/constants";
import { FaChartBar } from "Utils/icons";

const TaskListPage: React.FC = () => {
  const { openTaskDetail } = useTaskDetail();
  const dispatch = useAppDispatch();
  const { currentUser } = useAppSelector((state) => state.scheduler);
  const navigate = useNavigate();
  const [selectedManagerId, setSelectedManagerId] = useState("");

  const isAdmin =
    currentUser &&
    (ADMIN_ROLES.includes(currentUser.emp_designation) ||
      SUPER_ADMIN_ROLES.includes(currentUser.emp_designation));

  // Single fetch for this page — feeds Redux, which both the list and (elsewhere) the
  // timeline read. The admin manager filter scopes it server-side via user_id.
  const { data: taskData } = useTaskListQuery(
    !isAdmin
      ? { user_id: currentUser?.emp_id }
      : selectedManagerId
        ? { user_id: selectedManagerId }
        : {},
    {
      refetchOnMountOrArgChange: true,
      skip: !currentUser,
    }
  );


  useEffect(() => {
    if (taskData) {
      dispatch(addTask(Array.isArray(taskData) ? taskData : taskData.items ?? []));
    }
  }, [taskData, dispatch]);


  const allDevelopers = useAppSelector((state) => state.scheduler.developers);

  const managerList = React.useMemo(() => {
    return allDevelopers.filter((d) => {
      return [
        "L1",
        "L2",
        "EM",
        "CTO",
        "PRODUCT",
        "OWNER",
        "SUPERADMIN",
      ].includes(d.emp_designation);
    });
  }, [allDevelopers]);

  const handleEditTask = (task: Task) => {
    openTaskDetail(task);
  };

  return (
    <SimpleLayout>
      <Container maxW="container.xl" py={8}>
        <Flex justify="space-between" align="center" mb={6}>
          <Box>
            <Breadcrumb>
              <BreadcrumbItem>
                <BreadcrumbLink as={Link} to="/">
                  Home
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbItem isCurrentPage>
                <BreadcrumbLink href="#">Task List</BreadcrumbLink>
              </BreadcrumbItem>
            </Breadcrumb>
            <Heading size="lg" mt={2} color="gray.700">
              Task List
            </Heading>
            {isAdmin && (
              <Box mt={2}>
                <HStack>
                  <Select
                    placeholder="All Members"
                    w="200px"
                    size="sm"
                    bg="white"
                    value={selectedManagerId}
                    onChange={(e) => setSelectedManagerId(e.target.value)}
                  >
                    {managerList.map((mgr) => (
                      <option key={mgr.emp_id} value={mgr.emp_id}>
                        {mgr.emp_name} ({mgr.emp_designation})
                      </option>
                    ))}
                  </Select>
                </HStack>
              </Box>
            )}
          </Box>
          {isAdmin && (
            <Button
              leftIcon={<FaChartBar />}
              colorScheme="blue"
              onClick={() => navigate("/")}
              boxShadow="lg"
            >
              View Timeline
            </Button>
          )}
        </Flex>

        <TaskListingView
          onEditTask={handleEditTask}
          filteredManagerId={selectedManagerId}
        />
      </Container>
    </SimpleLayout>
  );
};

export default TaskListPage;
