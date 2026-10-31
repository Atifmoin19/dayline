import React, { Suspense, lazy } from "react";
import { Flex, Spinner, Text } from "@chakra-ui/react";
import { Route, Routes, useLocation } from "react-router-dom";

import { useAppSelector } from "app/hooks";
import { Navigate, Outlet } from "react-router-dom";
import NotFound from "Components/NotFound";
import { SUPER_ADMIN_ROLES } from "Utils/constants";

// Route-level code-splitting: each page becomes its own chunk, fetched on navigation
// instead of bundled into the single main chunk (which was tripping Vite's 500KB
// warning). Login is kept eager since it's commonly the first screen an unauthenticated
// user hits, and is cheap on its own.
import Login from "Pages/login";
import { useUserDirectorySync } from "hooks/useUserDirectorySync";
const Onboarding = lazy(() => import("Pages/onboarding"));
const Dashboard = lazy(() => import("Pages/dashboard"));
const TaskListPage = lazy(() => import("Pages/taskList"));
const TaskDetailPage = lazy(() => import("Pages/TaskDetailPage"));
const ProfilePage = lazy(() => import("Pages/profile"));
const ReportsPage = lazy(() => import("Pages/reports"));
const OrganizationPage = lazy(() => import("Pages/organization"));
const OrganizationResourceView = lazy(
  () => import("Pages/OrganizationResourceView"),
);
const EpicsListPage = lazy(() => import("Pages/EpicsListPage"));
const EpicDetailPage = lazy(() => import("Pages/EpicDetailPage"));
const RoadmapPage = lazy(() => import("Pages/RoadmapPage"));
const SprintsListPage = lazy(() => import("Pages/SprintsListPage"));
const SprintDetailPage = lazy(() => import("Pages/SprintDetailPage"));
const CreateTaskPage = lazy(() => import("Pages/SuperAdmin/CreateTaskPage"));
const CreateUserPage = lazy(() => import("Pages/SuperAdmin/CreateUserPage"));
const UserManagementPage = lazy(
  () => import("Pages/SuperAdmin/UserManagementPage"),
);
const AuditLogPage = lazy(() => import("Pages/SuperAdmin/AuditLogPage"));
const EmployeeOverviewPage = lazy(
  () => import("Pages/SuperAdmin/EmployeeOverviewPage"),
);

/** Fallback shown while a lazily-loaded route chunk is being fetched — mirrors the
 * centered Spinner + muted caption pattern already used for in-page async loading
 * (see `TaskDetailPage`'s "Loading task…" state). */
const RouteLoadingFallback: React.FC = () => (
  <Flex align="center" justify="center" h="100vh" direction="column" gap={3}>
    <Spinner />
    <Text color="neutral.500" fontSize="sm">
      Loading…
    </Text>
  </Flex>
);

const ProtectedRoute = () => {
  const { currentUser } = useAppSelector((state) => state.scheduler);
  const location = useLocation();
  useUserDirectorySync(); // one directory fetch for every authed route, deep links included
  return currentUser ? (
    <Outlet />
  ) : (
    <Navigate to="/login" state={{ from: location }} replace />
  );
};

const RoleProtectedRoute = ({ allowedRoles }: { allowedRoles: string[] }) => {
  const { currentUser } = useAppSelector((state) => state.scheduler);
  if (!currentUser) return <Navigate to="/login" replace />;

  if (!allowedRoles.includes(currentUser.emp_designation)) {
    return <Navigate to="/" replace />; // Redirect to basic dashboard if not authorized
  }

  return <Outlet />;
};

function StandardRoutes() {
  const location = useLocation();

  return (
    // Suspense sits around the route outlet only — ProtectedRoute/RoleProtectedRoute
    // are plain (non-lazy) components, so their redirect (`<Navigate />`) resolves
    // synchronously and is never delayed behind this fallback. It only engages while
    // a matched *page* chunk (lazy-loaded below) is being fetched.
    <Suspense fallback={<RouteLoadingFallback />}>
      <Routes location={location} key={location.pathname}>
        <Route path="/login" element={<Login />} />
        <Route path="/onboarding" element={<Onboarding />} />

        {/* Basic authenticated routes */}
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="" element={<Dashboard />} />
          <Route path="/task-list" element={<TaskListPage />} />
          <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/organization" element={<OrganizationPage />} />
          {/* Epics — company-wide, viewable by everyone (open, like task assignment).
              Edit/delete affordances are gated client-side (and enforced server-side) to the
              epic's owner/creator/admin, not the route itself. */}
          <Route path="/epics" element={<EpicsListPage />} />
          <Route path="/epics/:epicId" element={<EpicDetailPage />} />
          {/* Roadmap — a week/month-grain timeline over Epic date ranges (scale-gaps-plan.md
              §B.4). Company-wide read, same visibility as /epics itself. */}
          <Route path="/roadmap" element={<RoadmapPage />} />
          {/* Sprints/Cycles — company-wide, viewable by everyone (same reasoning as /epics).
              Edit/delete affordances are gated client-side (and enforced server-side) to the
              sprint's creator/admin, not the route itself. */}
          <Route path="/sprints" element={<SprintsListPage />} />
          <Route path="/sprints/:sprintId" element={<SprintDetailPage />} />
          {/* Same gating as /reports: no RoleProtectedRoute here — an IC's org-tree scope from
              the backend is just themselves, so the page renders gracefully for a scope of one
              even though the nav entry (Sidebar.tsx) is only surfaced to management. */}
          <Route path="/resources" element={<OrganizationResourceView />} />
        </Route>

        {/* Super Admin routes */}
        <Route
          element={<RoleProtectedRoute allowedRoles={SUPER_ADMIN_ROLES} />}
        >
          <Route path="/dashboard/create-task" element={<CreateTaskPage />} />
          <Route path="/dashboard/create-user" element={<CreateUserPage />} />
          <Route
            path="/dashboard/update-user"
            element={<UserManagementPage />}
          />
          <Route path="/dashboard/audit-log" element={<AuditLogPage />} />
          <Route
            path="/dashboard/employee-overview"
            element={<EmployeeOverviewPage />}
          />
        </Route>

        {/* Catch-all 404 */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

export const AppRouter: React.FC = () => {
  return <StandardRoutes />;
};
