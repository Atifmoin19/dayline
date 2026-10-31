import { useEffect } from "react";
import { useToast } from "@chakra-ui/react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAppSelector } from "app/hooks";
import { useUserDirectorySync } from "hooks/useUserDirectorySync";
import { APP_HOME } from "Utils/constants";

const DEMO_ADMIN_NOTICE = "Admin tools are turned off in the demo workspace.";

/** Redirects to the app home after showing `message` once as a toast. */
const RedirectHome = ({ message }: { message: string }) => {
  const toast = useToast();
  useEffect(() => {
    if (!toast.isActive("route-guard")) {
      toast({ id: "route-guard", title: message, status: "info", duration: 5000, isClosable: true });
    }
  }, [toast, message]);
  return <Navigate to={APP_HOME} replace />;
};

/** Any signed-in user. Also owns the single user-directory fetch for every authed route. */
export const ProtectedRoute = () => {
  const { currentUser } = useAppSelector((state) => state.scheduler);
  const location = useLocation();
  useUserDirectorySync(); // one directory fetch for every authed route, deep links included
  return currentUser ? <Outlet /> : <Navigate to="/login" state={{ from: location }} replace />;
};

/** Admin areas: the given designations only, and never demo-workspace users. */
export const RoleProtectedRoute = ({ allowedRoles }: { allowedRoles: string[] }) => {
  const { currentUser } = useAppSelector((state) => state.scheduler);
  if (!currentUser) return <Navigate to="/login" replace />;
  if (currentUser.is_demo) return <RedirectHome message={DEMO_ADMIN_NOTICE} />;
  if (!allowedRoles.includes(currentUser.emp_designation)) {
    return <Navigate to={APP_HOME} replace />;
  }
  return <Outlet />;
};
