import { useToast } from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";
import { useAppDispatch } from "app/hooks";
import { setCurrentUser, setToken } from "app/slices/scheduler.slice";
import { useDelayedFlag } from "hooks/useDelayedFlag";
import { useStartDemoMutation } from "Services/user.api";
import { getApiErrorMessage } from "Services/baseQuery";
import { DemoPersona } from "types";
import { APP_HOME } from "Utils/constants";

/** Free hosts sleep when idle; past this, tell the visitor why the first request is slow. */
export const WAKING_AFTER_MS = 2500;

/** Starts an isolated POST /demo workspace for a persona and signs straight into it. */
export const useDemoLaunch = () => {
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

  return { launch, isLoading, waking };
};
