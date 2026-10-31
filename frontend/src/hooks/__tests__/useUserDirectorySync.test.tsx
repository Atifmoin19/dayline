import React from "react";
import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { schedulerReducer, setCurrentUser } from "app/slices/scheduler.slice";
import { useUserListQuery } from "Services/user.api";
import { useUserDirectorySync } from "hooks/useUserDirectorySync";

vi.mock("Services/user.api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("Services/user.api")>();
  return { ...actual, useUserListQuery: vi.fn() };
});

const me = { emp_id: "s001", emp_name: "Alice", emp_email: "a@x.com", emp_designation: "Eng" };
const bob = { emp_id: "s002", emp_name: "Bob", emp_email: "b@x.com", emp_designation: "Eng" };

const setup = (loggedIn: boolean) => {
  const store = configureStore({ reducer: { scheduler: schedulerReducer } });
  if (loggedIn) store.dispatch(setCurrentUser(me));
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  return { store, wrapper };
};

describe("useUserDirectorySync", () => {
  beforeEach(() => (useUserListQuery as Mock).mockReset());

  it("loads the directory into the store on any authed route (e.g. a task deep link)", () => {
    (useUserListQuery as Mock).mockReturnValue({ data: [me, bob] });
    const { store, wrapper } = setup(true);
    renderHook(() => useUserDirectorySync(), { wrapper });
    expect(useUserListQuery).toHaveBeenCalledWith(undefined, { skip: false });
    expect(store.getState().scheduler.developers.map((d) => d.emp_id)).toEqual(["s001", "s002"]);
  });

  it("skips the request when nobody is logged in", () => {
    (useUserListQuery as Mock).mockReturnValue({ data: undefined });
    const { store, wrapper } = setup(false);
    renderHook(() => useUserDirectorySync(), { wrapper });
    expect(useUserListQuery).toHaveBeenCalledWith(undefined, { skip: true });
    expect(store.getState().scheduler.developers).toEqual([]);
  });
});
