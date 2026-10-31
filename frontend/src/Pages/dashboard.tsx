import React, { useEffect, useState } from "react";
import {
  Box,
  Button,
  Flex,
  useDisclosure,
  Text,
  HStack,
  Select,
} from "@chakra-ui/react";

import TimelineView from "Components/Timeline/TimelineView";
import TaskCreationModal from "Components/Timeline/TaskCreationModal";
import TaskListingView from "Components/Timeline/TaskListingView";
import CalendarView from "Components/Timeline/CalendarView";
import WeekView from "Components/Timeline/WeekView";
import DashboardOverview from "Components/DashboardOverview";
import AIInsightPanel from "Components/AIInsightPanel";
import { useAppDispatch, useAppSelector } from "app/hooks";
import { Task } from "types";
import SimpleLayout from "Layouts/simpleLayout";
import { useTaskDetail } from "Contexts/useTaskDetail";
import { addDeveloper, addTask } from "app/slices/scheduler.slice";
import { useTaskListQuery, useLazyUserListQuery } from "Services/user.api";
import { ADMIN_ROLES, SUPER_ADMIN_ROLES } from "Utils/constants";
import { getManagerOptions } from "Utils/orgTree";
import { BRAND_GLOW } from "Styles";

const Dashboard: React.FC = () => {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const { openTaskDetail } = useTaskDetail();
  const [view, setView] = useState<"timeline" | "week" | "list" | "calendar">("timeline");
  const { currentUser, tasks } = useAppSelector((state) => state.scheduler);

  // Assuming currentUser is available in scope or imported
  const empDesignation = currentUser?.emp_designation || "";
  const isL1Admin = ADMIN_ROLES.includes(empDesignation);
  const isSuperAdmin = SUPER_ADMIN_ROLES.includes(empDesignation);
  // "Admin" for layout purposes includes both
  const isManagement = isL1Admin || isSuperAdmin;

  const dispatch = useAppDispatch();

  // Force refetch on mount or when args change to avoid stale data
  // If Management, fetch all tasks (no user_id). If regular user, fetch ONLY their tasks.
  const { data: taskData } = useTaskListQuery(
    { ...(!isManagement && { user_id: currentUser?.emp_id }) },
    {
      refetchOnMountOrArgChange: true,
      skip: !currentUser, // Wait until we know who the user is
    },
  );

  const [getUserList] = useLazyUserListQuery();

  useEffect(() => {
    if (taskData) {
      dispatch(addTask(Array.isArray(taskData) ? taskData : taskData.items ?? []));
    }
  }, [taskData, dispatch]);

  const allDevelopers = useAppSelector((state) => state.scheduler.developers);
  const [selectedManagerId, setSelectedManagerId] = useState("");

  // Managers the current user may drill into: only those inside their own org-tree scope
  // (self + subtree) who actually have reports. No seniors, no peers.
  const managerList = React.useMemo(
    () => getManagerOptions(allDevelopers, currentUser),
    [allDevelopers, currentUser],
  );

  // Load the full user directory (any authed user may read it). The timeline decides which
  // rows to show by role; the hierarchy popover needs the whole directory to resolve a
  // person's manager (fixes "No Manager" on a developer's own view) and to show a manager +
  // their reportees (self included).
  useEffect(() => {
    if (currentUser) {
      getUserList()
        .unwrap()
        .then((resp) => {
          dispatch(addDeveloper(resp || []));
        })
        .catch(() => {});
    }
  }, [currentUser, getUserList, dispatch]);
  const handleCreateTask = () => {
    onOpen();
  };

  const handleEditTask = (task: Task) => {
    openTaskDetail(task);
  };

  const SEG: { key: typeof view; label: string }[] = [
    { key: "timeline", label: "Timeline" },
    { key: "week", label: "Week" },
    { key: "calendar", label: "Calendar" },
    { key: "list", label: "List" },
  ];

  return (
    <SimpleLayout>
      <Box>
        {/* Rich overview: gradient hero + live KPI tiles */}
        {currentUser && (
          <DashboardOverview
            currentUser={currentUser}
            tasks={tasks}
            developers={allDevelopers}
            isManagement={isManagement}
            onCreateTask={handleCreateTask}
          />
        )}

        {/* AI-generated workload summary + recommendations (GET /insights) */}
        {currentUser && <AIInsightPanel />}

        {/* Toolbar */}
        <Flex
          justify="space-between"
          align={{ base: "start", md: "center" }}
          direction={{ base: "column", md: "row" }}
          gap={3}
          mb={5}
        >
          <Text fontSize="lg" fontWeight={800} color="neutral.900">
            {isManagement ? "Team Schedule" : "My Schedule"}
          </Text>
          <HStack spacing={3}>
            {isManagement && (
              <Select
                placeholder="All Members"
                w="190px"
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
            )}
            <Flex bg="white" border="1px solid" borderColor="surface.border" borderRadius="10px" p="3px">
              {SEG.map((s) => (
                <Button
                  key={s.key}
                  size="sm"
                  variant="ghost"
                  onClick={() => setView(s.key)}
                  bg={view === s.key ? "brand.600" : "transparent"}
                  color={view === s.key ? "white" : "neutral.500"}
                  boxShadow={view === s.key ? BRAND_GLOW : undefined}
                  _hover={{ bg: view === s.key ? "brand.600" : "neutral.50" }}
                  borderRadius="8px"
                  fontWeight={600}
                >
                  {s.label}
                </Button>
              ))}
            </Flex>
          </HStack>
        </Flex>

        {/* Selected view */}
        {view === "timeline" && (
          <TimelineView onEditTask={handleEditTask} filteredManagerId={selectedManagerId} />
        )}
        {view === "week" && (
          <WeekView onEditTask={handleEditTask} filteredManagerId={selectedManagerId} />
        )}
        {view === "calendar" && (
          <CalendarView onEditTask={handleEditTask} filteredManagerId={selectedManagerId} />
        )}
        {view === "list" && <TaskListingView onEditTask={handleEditTask} />}

        <TaskCreationModal isOpen={isOpen} onClose={onClose} />
      </Box>
    </SimpleLayout>
  );
};

export default Dashboard;
