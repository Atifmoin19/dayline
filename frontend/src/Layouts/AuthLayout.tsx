import { Box } from "@chakra-ui/react";
import React from "react";
import { HERO_GRADIENT } from "Styles";

/** Bare, chrome-less layout for unauthenticated pages (login/signup). No sidebar/header. */
const AuthLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box minH="100vh" bg={HERO_GRADIENT} display="flex" alignItems="center" justifyContent="center" p={4}>
    {children}
  </Box>
);

export default AuthLayout;
