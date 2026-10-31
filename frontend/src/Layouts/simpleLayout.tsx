import {
  Box,
  Drawer,
  DrawerOverlay,
  DrawerContent,
  DrawerCloseButton,
  DrawerBody,
  IconButton,
  useDisclosure,
} from "@chakra-ui/react";
import { FaPlus } from "Utils/icons";
import React from "react";
import Header from "Components/Header";
import Sidebar from "Components/Sidebar";
import TaskCreationModal from "Components/Timeline/TaskCreationModal";
import { BRAND_GRADIENT, BRAND_GLOW, BRAND_GLOW_HOVER } from "Styles";
import { HEADER_HEIGHT, SIDEBAR_WIDTH } from "Utils/constants";
import { useRealtimeSync } from "hooks/useRealtimeSync";
import DemoBanner from "Components/Demo/DemoBanner";

interface ISimpleLayout {
  hasStripTransition?: boolean;
  hideSidebar?: boolean;
  children: React.ReactNode;
}

/**
 * Authenticated app shell: a full-width fixed Header on top, then a fixed left Sidebar and the
 * scrollable content body below it. Pass `hideSidebar` for focused pages (e.g. Profile) that want
 * the body to span the full width. A global Create-Task modal (sidebar CTA + FAB) lives here.
 *
 * The Sidebar rail is fixed-width and desktop-only (hidden below the `md` breakpoint — see
 * Sidebar.tsx); below that, the same nav renders inside this Drawer, opened via the Header's
 * hamburger button. `hideSidebar` only affects the persistent rail, not this mobile drawer —
 * a phone user still needs some way to navigate away from a "focused" page like Profile.
 */
const SimpleLayout: React.FC<ISimpleLayout> = ({ children, hideSidebar }) => {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const { isOpen: isNavOpen, onOpen: onNavOpen, onClose: onNavClose } = useDisclosure();
  useRealtimeSync(); // live task updates over WebSocket (falls back to the 60 s poll)

  return (
    <Box minH="100vh" bg="surface.page">
      <Header onOpenNav={onNavOpen} />

      {!hideSidebar && <Sidebar onCreateTask={onOpen} />}

      <Drawer isOpen={isNavOpen} placement="left" onClose={onNavClose}>
        <DrawerOverlay />
        <DrawerContent maxW="248px">
          <DrawerCloseButton />
          <DrawerBody p={0}>
            <Sidebar
              variant="drawer"
              onCreateTask={onOpen}
              onNavigate={onNavClose}
            />
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      <Box
        as="main"
        ml={hideSidebar ? 0 : { base: 0, md: SIDEBAR_WIDTH }}
        mt={HEADER_HEIGHT}
        px={{ base: 4, md: 8 }}
        py={6}
        minW={0}
      >
        <DemoBanner />
        {children}
      </Box>

      {/* Floating create-task action */}
      <IconButton
        aria-label="Create Task"
        icon={<FaPlus />}
        onClick={onOpen}
        position="fixed"
        bottom={8}
        right={8}
        size="lg"
        borderRadius="full"
        boxShadow={BRAND_GLOW}
        bg={BRAND_GRADIENT}
        color="white"
        _hover={{ opacity: 0.92, boxShadow: BRAND_GLOW_HOVER }}
        _active={{ transform: "scale(0.97)" }}
        zIndex={800}
      />

      <TaskCreationModal isOpen={isOpen} onClose={onClose} />
    </Box>
  );
};

export default SimpleLayout;
