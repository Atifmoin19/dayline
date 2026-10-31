import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "app/hooks";
import { addDeveloper } from "app/slices/scheduler.slice";
import { useUserListQuery } from "Services/user.api";

/**
 * Single owner of the user directory. Mounted once by the protected-route shell, so every
 * authenticated page (including a cold-loaded deep link such as /tasks/:id) gets the same
 * RTK Query cache entry mirrored into `scheduler.developers`. Pages no longer fetch it
 * themselves, which is what left assignees showing "Unassigned" on deep links.
 */
export const useUserDirectorySync = () => {
  const dispatch = useAppDispatch();
  const loggedIn = useAppSelector((state) => Boolean(state.scheduler.currentUser));
  const { data } = useUserListQuery(undefined, { skip: !loggedIn });

  useEffect(() => {
    if (data) dispatch(addDeveloper(data));
  }, [data, dispatch]);
};
