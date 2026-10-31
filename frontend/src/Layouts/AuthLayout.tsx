import { Box, Flex, Link } from "@chakra-ui/react";
import React from "react";
import { Link as RouterLink } from "react-router-dom";
import { HERO_GRADIENT } from "Styles";

/**
 * Layout for unauthenticated pages (login, request a workspace, onboarding). No app sidebar or
 * header, but always a way back to the public landing page so these pages are never a dead end.
 */
const AuthLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Flex minH="100vh" bg={HERO_GRADIENT} direction="column">
    <Box as="nav" aria-label="Site" px={{ base: 4, md: 8 }} pt={{ base: 4, md: 6 }}>
      <Link
        as={RouterLink}
        to="/"
        display="inline-flex"
        alignItems="center"
        gap={2}
        minH="44px"
        px={3}
        borderRadius="full"
        fontSize="sm"
        fontWeight={600}
        color="neutral.700"
        bg="whiteAlpha.800"
        border="1px solid"
        borderColor="neutral.200"
        _hover={{ bg: "white", textDecoration: "none", color: "neutral.900" }}
        _focusVisible={{ outline: "2px solid", outlineColor: "brand.500", outlineOffset: "2px" }}
      >
        <span aria-hidden="true">&larr;</span> Back to home
      </Link>
    </Box>
    <Flex flex="1" align="center" justify="center" p={4}>
      {children}
    </Flex>
  </Flex>
);

export default AuthLayout;
