import { Box, Flex, Text, Button, VStack, Icon } from "@chakra-ui/react";
import {
  FaThLarge,
  FaPlus,
  FaChartBar,
  FaTasks,
  FaUserPlus,
  FaUserEdit,
  FaSitemap,
  FaUsers,
  FaFlag,
  FaMap,
  FaBolt,
  FaHistory,
} from "Utils/icons";
import { IconType } from "react-icons";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppSelector } from "app/hooks";
import { SUPER_ADMIN_ROLES, ADMIN_ROLES, HEADER_HEIGHT, SIDEBAR_WIDTH, APP_HOME } from "Utils/constants";
import { BRAND_GRADIENT, BRAND_GLOW, BRAND_GLOW_HOVER } from "Styles";

interface NavItem {
  label: string;
  to: string;
  icon: IconType;
}

interface SidebarProps {
  onCreateTask: () => void;
  /** "fixed" (default) = the always-on desktop rail (hidden below `md`, see mobile-nav note
   * below). "drawer" = the same nav content rendered plainly, for reuse inside the Chakra
   * <Drawer> that SimpleLayout opens from a hamburger button on narrow viewports. */
  variant?: "fixed" | "drawer";
  /** Drawer variant only: called after a nav item / Create Task is activated, so the caller
   * can close the drawer. */
  onNavigate?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ onCreateTask, variant = "fixed", onNavigate }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useAppSelector((state) => state.scheduler);

  const designation = currentUser?.emp_designation || "";
  // Demo workspaces have no admin features (the backend refuses them), so hide that section.
  const isSuperAdmin = !currentUser?.is_demo && SUPER_ADMIN_ROLES.includes(designation);
  const isManagement = isSuperAdmin || ADMIN_ROLES.includes(designation);

  // Primary nav. (Task List / Profile removed — List is a dashboard view toggle, Profile
  // lives in the header menu.)
  const primary: NavItem[] = [
    { label: "My Work", to: APP_HOME, icon: FaThLarge },
    { label: "Organization", to: "/organization", icon: FaSitemap },
    // Company-wide, open to everyone (viewing AND creating) — same tier as My Work/Organization,
    // not under Administration below.
    { label: "Epics", to: "/epics", icon: FaFlag },
    // Roadmap/Gantt over Epic date ranges — read-only view, same company-wide visibility as
    // Epics itself (scale-gaps-plan.md §B.4).
    { label: "Roadmap", to: "/roadmap", icon: FaMap },
    // Sprints/Cycles — company-wide, open to everyone (same tier as Epics).
    { label: "Sprints", to: "/sprints", icon: FaBolt },
  ];
  if (isManagement) {
    primary.push({ label: "Reports", to: "/reports", icon: FaChartBar });
    primary.push({ label: "Resources", to: "/resources", icon: FaUsers });
  }

  // Admin operations spread directly into the sidebar (no separate Admin Console landing).
  const adminItems: NavItem[] = isSuperAdmin
    ? [
        { label: "Create Tasks", to: "/dashboard/create-task", icon: FaTasks },
        { label: "Create Users", to: "/dashboard/create-user", icon: FaUserPlus },
        { label: "Manage Users", to: "/dashboard/update-user", icon: FaUserEdit },
        // Org-wide admin action log (scale-gaps-plan.md Phase 3, item 2) — user
        // create/update/delete/bulk-delete/CSV-import, task CSV-import.
        { label: "Audit Log", to: "/dashboard/audit-log", icon: FaHistory },
        // Onboarding status / availability / task-load, every employee company-wide.
        { label: "Employee Overview", to: "/dashboard/employee-overview", icon: FaUsers },
      ]
    : [];

  const isActive = (to: string) =>
    to === APP_HOME ? location.pathname === APP_HOME : location.pathname.startsWith(to);

  const NavRow = ({ item }: { item: NavItem }) => {
    const active = isActive(item.to);
    return (
      <Flex
        align="center"
        gap={3}
        px={3}
        py={2.5}
        borderRadius="0.6rem"
        cursor="pointer"
        role="button"
        tabIndex={0}
        aria-current={active ? "page" : undefined}
        onClick={() => {
          navigate(item.to);
          onNavigate?.();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            navigate(item.to);
            onNavigate?.();
          }
        }}
        bg={active ? "brand.50" : "transparent"}
        color={active ? "brand.700" : "neutral.600"}
        fontWeight={active ? 600 : 500}
        _hover={{ bg: active ? "brand.50" : "neutral.50", color: active ? "brand.700" : "neutral.800" }}
        _focusVisible={{ outline: "2px solid", outlineColor: "blue.400", outlineOffset: "-2px" }}
      >
        <Icon as={item.icon} boxSize={4} />
        <Text fontSize="sm" color="inherit" fontWeight="inherit">
          {item.label}
        </Text>
      </Flex>
    );
  };

  const isDrawer = variant === "drawer";

  return (
    <Box
      as={isDrawer ? "div" : "aside"}
      // Desktop rail is fixed + hidden below `md` (768px) — this internal enterprise app's
      // primary nav otherwise has no mobile affordance at all, so <768px it's rendered
      // instead inside a Drawer (see SimpleLayout's hamburger button) reusing this same
      // component/content, just without the fixed positioning.
      position={isDrawer ? "static" : "fixed"}
      display={isDrawer ? "flex" : { base: "none", md: "flex" }}
      left={isDrawer ? undefined : 0}
      top={isDrawer ? undefined : HEADER_HEIGHT}
      h={isDrawer ? "100%" : `calc(100vh - ${HEADER_HEIGHT})`}
      w={isDrawer ? "100%" : SIDEBAR_WIDTH}
      bg="white"
      borderRight={isDrawer ? undefined : "1px solid"}
      borderColor="surface.border"
      px={4}
      py={5}
      flexDirection="column"
      zIndex={1000}
    >
      {/* Primary CTA */}
      <Button
        leftIcon={<FaPlus />}
        onClick={() => {
          onCreateTask();
          onNavigate?.();
        }}
        w="full"
        mb={6}
        bg={BRAND_GRADIENT}
        color="white"
        boxShadow={BRAND_GLOW}
        _hover={{ opacity: 0.92, boxShadow: BRAND_GLOW_HOVER }}
        _active={{ opacity: 0.85, transform: "scale(0.97)" }}
      >
        Create Task
      </Button>

      {/* Nav */}
      <VStack align="stretch" spacing={1}>
        {primary.map((item) => (
          <NavRow key={item.to} item={item} />
        ))}

        {adminItems.length > 0 && (
          <>
            <Text
              px={3}
              pt={4}
              pb={1}
              fontSize="xs"
              fontWeight={700}
              color="neutral.500"
              textTransform="uppercase"
              letterSpacing="0.05em"
            >
              Administration
            </Text>
            {adminItems.map((item) => (
              <NavRow key={item.to} item={item} />
            ))}
          </>
        )}
      </VStack>

      <Box flex="1" />

      {isManagement && (
        <Text px={3} fontSize="xs" color="neutral.500">
          {designation} · Management
        </Text>
      )}
    </Box>
  );
};

export default Sidebar;
