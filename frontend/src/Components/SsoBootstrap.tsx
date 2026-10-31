import React, { useEffect, useState } from "react";
import { Flex, Spinner, Text } from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";

import { useAppDispatch } from "app/hooks";
import { resetStore, setCurrentUser, setToken } from "app/slices/scheduler.slice";
import { useLazyAuthMeQuery } from "Services/user.api";

/** Picks a `#sso_token=...` fragment off the URL (see `main.py`'s `/auth/sso/callback`,
 * which redirects here after a successful IdP login) and hydrates the same Redux state
 * `login`/`register` set inline. A fragment (never a query param) so the token is never
 * sent to any server or written to access logs on the trip back from the IdP.
 *
 * Renders a blocking spinner while this resolves — without it, `ProtectedRoute` would see
 * `currentUser` still null on first render and redirect to `/login` before this effect's
 * async `/auth/me` call ever gets a chance to complete. */
const SsoBootstrap: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [resolving, setResolving] = useState(
    () => window.location.hash.includes("sso_token="),
  );
  const [triggerAuthMe] = useLazyAuthMeQuery();

  useEffect(() => {
    if (!resolving) return;

    const match = window.location.hash.match(/sso_token=([^&]+)/);
    const token = match ? decodeURIComponent(match[1]) : null;
    // Strip the fragment immediately regardless of outcome — it must not linger in the
    // visible URL or browser history once read.
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );

    if (!token) {
      setResolving(false);
      return;
    }

    dispatch(setToken(token));
    triggerAuthMe()
      .unwrap()
      .then((userData) => {
        dispatch(setCurrentUser(userData));
      })
      .catch(() => {
        dispatch(resetStore());
        navigate("/login", { replace: true });
      })
      .finally(() => setResolving(false));
    // Runs once on mount only — deliberately ignores the lint-suggested dep array, since
    // re-running this on every dispatch/navigate identity change would re-parse a fragment
    // that's already been stripped above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (resolving) {
    return (
      <Flex align="center" justify="center" h="100vh" direction="column" gap={3}>
        <Spinner />
        <Text color="neutral.500" fontSize="sm">
          Signing you in…
        </Text>
      </Flex>
    );
  }

  return <>{children}</>;
};

export default SsoBootstrap;
