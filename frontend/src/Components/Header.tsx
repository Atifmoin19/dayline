import {
  Flex,
  Text,
  Box,
  Icon,
  IconButton,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  MenuDivider,
} from "@chakra-ui/react";
import { FaUserCircle, FaPowerOff, FaChevronDown, FaRegCheckCircle, FaBars } from "Utils/icons";
import { useNavigate } from "react-router-dom";
import { HEADER_HEIGHT } from "Utils/constants";
import { useAppSelector, useAppDispatch } from "app/hooks";
import { resetStore } from "app/slices/scheduler.slice";
import { useLogoutMutation } from "Services/user.api";
import { BRAND_GRADIENT } from "Styles";
import UserAvatar from "./UserAvatar";
import NotificationCenter from "./NotificationCenter";

interface HeaderProps {
  /** Opens the mobile nav Drawer (SimpleLayout). Renders a hamburger button, visible only
   * below the `md` breakpoint — the persistent Sidebar rail is desktop-only. */
  onOpenNav?: () => void;
}

/** Full-width top bar: brand/logo (→ home) on the left, notifications + profile menu on the right. */
const Header: React.FC<HeaderProps> = ({ onOpenNav }) => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { currentUser } = useAppSelector((state) => state.scheduler);
  const [logout] = useLogoutMutation();

  const handleLogout = () => {
    const finish = () => {
      dispatch(resetStore());
      sessionStorage.removeItem("pendingModalShown");
      navigate("/login", { replace: true });
    };
    logout().unwrap().then(finish).catch(finish);
  };

  return (
    <Flex
      as="header"
      height={HEADER_HEIGHT}
      bg="rgba(255,255,255,0.85)"
      backdropFilter="blur(10px)"
      position="fixed"
      top={0}
      left={0}
      right={0}
      w="100%"
      px={6}
      alignItems="center"
      justifyContent="space-between"
      borderBottom="1px solid"
      borderColor="surface.border"
      zIndex={1100}
    >
      <Flex align="center" gap={1}>
        {/* Mobile-only nav trigger — the persistent Sidebar rail is desktop-only (hidden
            below `md`), so this Drawer is the only way to reach primary nav on a phone. */}
        {onOpenNav && (
          <IconButton
            aria-label="Open navigation menu"
            icon={<FaBars />}
            onClick={onOpenNav}
            variant="ghost"
            display={{ base: "inline-flex", md: "none" }}
            mr={1}
          />
        )}

        {/* Brand → home */}
        <Flex
          align="center"
          gap={3}
          cursor="pointer"
          role="button"
          tabIndex={0}
          aria-label="TaskBoard home"
          onClick={() => navigate("/")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              navigate("/");
            }
          }}
          _focusVisible={{ outline: "2px solid", outlineColor: "blue.400", outlineOffset: "2px", borderRadius: "md" }}
        >
          <Flex
            w="34px"
            h="34px"
            borderRadius="0.6rem"
            align="center"
            justify="center"
            bg={BRAND_GRADIENT}
            color="white"
          >
            <Icon as={FaRegCheckCircle} boxSize={4} />
          </Flex>
          <Box lineHeight="1.1">
            <Text fontSize="md" fontWeight={700} color="neutral.900">
              TaskBoard
            </Text>
            <Text fontSize="10px" color="neutral.500">
              Enterprise Edition
            </Text>
          </Box>
        </Flex>
      </Flex>

      {currentUser && (
        <Flex alignItems="center" gap={2}>
          <NotificationCenter />

          <Menu placement="bottom-end">
            <MenuButton
              as={Flex}
              align="center"
              gap={3}
              pl={4}
              ml={2}
              borderLeft="1px solid"
              borderColor="surface.border"
              cursor="pointer"
              role="button"
            >
              <Flex align="center" gap={3}>
                <Box textAlign="right" lineHeight="1.2" display={{ base: "none", md: "block" }}>
                  <Text fontSize="sm" fontWeight={600} color="neutral.900">
                    {currentUser.emp_name}
                  </Text>
                  <Text fontSize="xs" color="neutral.500">
                    {currentUser.emp_designation}
                  </Text>
                </Box>
                <UserAvatar size="sm" name={currentUser.emp_name} photo={currentUser.profile_pic} />
                <Box as={FaChevronDown} color="neutral.500" fontSize="0.7rem" />
              </Flex>
            </MenuButton>
            <MenuList minW="180px" boxShadow="xl" borderColor="surface.border">
              <MenuItem icon={<FaUserCircle />} onClick={() => navigate("/profile")}>
                Profile
              </MenuItem>
              <MenuDivider />
              <MenuItem icon={<FaPowerOff />} color="red.600" onClick={handleLogout}>
                Logout
              </MenuItem>
            </MenuList>
          </Menu>
        </Flex>
      )}
    </Flex>
  );
};

export default Header;
