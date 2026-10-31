import { Button, Flex, Text, useToast } from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";
import { useAppDispatch } from "app/hooks";
import { setCurrentUser, setToken } from "app/slices/scheduler.slice";
import { useDelayedFlag } from "hooks/useDelayedFlag";
import { useStartDemoMutation } from "Services/user.api";
import { getApiErrorMessage } from "Services/baseQuery";
import { DemoPersona } from "types";
import { APP_HOME } from "Utils/constants";

/** Free hosts sleep when idle; past this, tell the visitor why the first request is slow. */
const WAKING_AFTER_MS = 2500;

/** "Try the demo": starts an isolated POST /demo workspace and signs straight into it. */
const DemoLauncher = () => {
  const [startDemo, { isLoading }] = useStartDemoMutation();
  const waking = useDelayedFlag(isLoading, WAKING_AFTER_MS);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const toast = useToast();

  const launch = async (persona: DemoPersona) => {
    try {
      const result = await startDemo({ persona }).unwrap();
      dispatch(setToken(result.token));
      dispatch(setCurrentUser({ ...result.userData, demo_expires_at: result.demo?.expires_at }));
      navigate(APP_HOME, { replace: true });
    } catch (error) {
      toast({
        title: "Couldn't start the demo",
        description: getApiErrorMessage(error, "Please try again in a moment."),
        status: "error",
      });
    }
  };

  return (
    <Flex direction="column" align="center" gap={1}>
      <Button
        type="button"
        width="full"
        size="lg"
        variant="outline"
        colorScheme="brand"
        isLoading={isLoading}
        loadingText={waking ? "Waking the server…" : "Setting up your demo…"}
        onClick={() => launch("manager")}
      >
        Try the demo
      </Button>
      <Button
        type="button"
        variant="link"
        size="sm"
        colorScheme="brand"
        isDisabled={isLoading}
        onClick={() => launch("developer")}
      >
        or explore as a developer
      </Button>
      {waking && (
        <Text fontSize="xs" color="neutral.500" role="status">
          The first request after a quiet spell can take up to a minute.
        </Text>
      )}
    </Flex>
  );
};

export default DemoLauncher;
