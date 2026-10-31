import React, { useState } from "react";
import {
  Box,
  Button,
  FormControl,
  FormLabel,
  Input,
  VStack,
  Heading,
  Text,
  useToast,
  Icon,
  Flex,
} from "@chakra-ui/react";
import { FaRegCheckCircle, FaBolt, FaUsers, FaChartLine } from "Utils/icons";
import { useAppDispatch } from "app/hooks";
import { setCurrentUser, setToken } from "app/slices/scheduler.slice";
import { useNavigate, useLocation, Link as RouterLink } from "react-router-dom";
import {
  useLoginMutation,
  useSsoStatusQuery,
} from "Services/user.api";
import { getApiErrorMessage } from "Services/baseQuery";
import { BRAND_GRADIENT } from "Styles";
import { BASE_URL } from "Utils/constants";
import AuthLayout from "Layouts/AuthLayout";

const Login: React.FC = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  // Where an unauthenticated visit was redirected from (ProtectedRoute), e.g. a shared task link
  // — so login/signup lands back on the thing they actually opened, not always the dashboard.
  const from = (location.state as { from?: { pathname: string; search?: string } } | null)?.from;
  const redirectTarget = from ? `${from.pathname}${from.search || ""}` : "/";
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [login, { isLoading }] = useLoginMutation();
  // Unset OIDC_ISSUER on the backend => {enabled: false}, button stays hidden; local
  // emp_id/password login is unaffected either way.
  const { data: ssoStatus } = useSsoStatusQuery();

  // Surface a failed SSO round-trip (main.py's /auth/sso/callback redirects errors back
  // here as ?sso_error=<reason> — never a query param on success, that one only carries
  // the token in a URL fragment, see SsoBootstrap).
  React.useEffect(() => {
    const params = new URLSearchParams(location.search);
    const ssoError = params.get("sso_error");
    if (ssoError) {
      toast({
        title: "Single sign-on failed",
        description: ssoError.replace(/_/g, " "),
        status: "error",
      });
      navigate(location.pathname, { replace: true, state: location.state });
    }
    // Only meant to fire once for whatever error the redirect landed with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSsoLogin = () => {
    window.location.href = `${BASE_URL}/auth/sso/login?next=${encodeURIComponent(redirectTarget)}`;
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId.trim() || !password.trim()) {
      toast({
        title: "Validation Error",
        description: "Please fill all required fields",
        status: "error",
      });
      return;
    }

    try {
      // Passing password if the API supports it, otherwise just ID as before
      const result = await login({ emp_id: userId, password }).unwrap();
      if (result) {
        dispatch(setToken(result?.token));
        dispatch(setCurrentUser(result?.userData));
        toast({
          title: `Welcome ${result?.userData?.emp_name}`,
          status: "success",
        });

        // Everyone lands on My Work by default. Admin actions live in the sidebar's
        // Administration section (the old Admin Console landing was removed) — but if this
        // login was triggered by visiting a protected deep link (e.g. a shared task link)
        // while signed out, send them back to that link instead.
        navigate(redirectTarget, { replace: true });
      }
    } catch (error) {
      const errorMsg = getApiErrorMessage(error, "User not found or API error.");
      toast({
        title: "Login Failed",
        description: errorMsg,
        status: "error",
      });
    }
  };

  return (
    <AuthLayout>
      <Flex
        w={{ base: "100%", md: "960px" }}
        minH={{ base: "auto", md: "580px" }}
        maxW="960px"
        bg="white"
        borderRadius="1.25rem"
        boxShadow="0 24px 64px rgba(15,23,42,0.16)"
        overflow="hidden"
      >
        {/* Left — brand marketing panel */}
        <Flex
          display={{ base: "none", md: "flex" }}
          w="46%"
          direction="column"
          justify="space-between"
          p={10}
          color="white"
          bg={BRAND_GRADIENT}
          position="relative"
        >
          <Box
            position="absolute"
            inset={0}
            opacity={0.12}
            bgImage="radial-gradient(circle at 80% 10%, white 0, transparent 40%), radial-gradient(circle at 10% 90%, white 0, transparent 35%)"
          />
          <Flex align="center" gap={3} zIndex={1}>
            <Flex w="40px" h="40px" borderRadius="0.7rem" align="center" justify="center" bg="whiteAlpha.300">
              <Icon as={FaRegCheckCircle} boxSize={5} />
            </Flex>
            <Box lineHeight="1.1">
              <Text fontSize="lg" fontWeight={700} color="white">TaskBoard</Text>
              <Text fontSize="xs" color="whiteAlpha.800">Enterprise Edition</Text>
            </Box>
          </Flex>

          <Box zIndex={1}>
            <Heading size="2xl" color="white" lineHeight="1.15" mb={3}>
              Plan, track and ship work with your team.
            </Heading>
            <Text fontSize="sm" color="whiteAlpha.900">
              Real-time scheduling, capacity-aware assignment and a live timeline —
              built for engineering teams.
            </Text>
          </Box>

          <VStack align="stretch" spacing={3} zIndex={1}>
            {[
              { icon: FaBolt, t: "Live daily timeline & auto-scheduling" },
              { icon: FaUsers, t: "Team availability at a glance" },
              { icon: FaChartLine, t: "Priorities, sessions & time tracking" },
            ].map((f) => (
              <Flex key={f.t} align="center" gap={3}>
                <Flex w="28px" h="28px" borderRadius="full" align="center" justify="center" bg="whiteAlpha.300">
                  <Icon as={f.icon} boxSize={3.5} color="white" />
                </Flex>
                <Text fontSize="sm" color="whiteAlpha.900">{f.t}</Text>
              </Flex>
            ))}
          </VStack>
        </Flex>

        {/* Right — form */}
        <Flex flex="1" direction="column" justify="center" p={{ base: 8, md: 12 }}>
          <Box mb={8}>
            <Heading size="lg" color="neutral.900" mb={1}>
              Welcome back
            </Heading>
            <Text color="neutral.500" fontSize="sm">
              Sign in to access your workspace.
            </Text>
          </Box>

          <VStack spacing={4} as="form" onSubmit={handleAuth} align="stretch">
            <FormControl isRequired>
              <FormLabel fontSize="sm" fontWeight={600}>Employee ID</FormLabel>
              <Input
                placeholder="e.g. EMP001"
                size="lg"
                bg="neutral.50"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
              />
            </FormControl>

            <FormControl isRequired>
              <FormLabel fontSize="sm" fontWeight={600}>Password</FormLabel>
              <Input
                type="password"
                placeholder="••••••••"
                size="lg"
                bg="neutral.50"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </FormControl>

            <Button
              type="submit"
              width="full"
              size="lg"
              mt={2}
              bg={BRAND_GRADIENT}
              color="white"
              _hover={{ opacity: 0.92 }}
              isLoading={isLoading}
            >
              Sign In
            </Button>

            {ssoStatus?.enabled && (
              <>
                <Flex align="center" gap={3}>
                  <Box flex="1" h="1px" bg="neutral.200" />
                  <Text fontSize="xs" color="neutral.400">
                    OR
                  </Text>
                  <Box flex="1" h="1px" bg="neutral.200" />
                </Flex>
                <Button
                  type="button"
                  width="full"
                  size="lg"
                  variant="outline"
                  borderColor="neutral.200"
                  onClick={handleSsoLogin}
                >
                  Sign in with {ssoStatus.provider_label}
                </Button>
              </>
            )}
          </VStack>

          <Flex justify="center" align="center" gap={1} mt={6}>
            <Text fontSize="sm" color="neutral.500">
              New to TaskBoard?
            </Text>
            <Button
              as={RouterLink}
              to="/onboarding"
              state={location.state}
              variant="link"
              colorScheme="brand"
              fontWeight={700}
              fontSize="sm"
            >
              Get started
            </Button>
          </Flex>
        </Flex>
      </Flex>
    </AuthLayout>
  );
};

export default Login;
