import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { schedulerReducer, setCurrentUser } from "app/slices/scheduler.slice";
import DemoBanner from "Components/Demo/DemoBanner";
import { hoursUntil } from "Utils/demo";
import { Employee } from "types";

const base: Employee = { emp_id: "w-QB0001", emp_name: "Odile", emp_email: "o@x.com", emp_designation: "CTO" };

const renderWith = (user: Employee | null) => {
  const store = configureStore({ reducer: { scheduler: schedulerReducer } });
  store.dispatch(setCurrentUser(user));
  return render(
    <Provider store={store}>
      <ChakraProvider>
        <DemoBanner />
      </ChakraProvider>
    </Provider>,
  );
};

describe("DemoBanner", () => {
  it("is hidden for regular users", () => {
    renderWith(base);
    expect(screen.queryByText(/Demo workspace/)).toBeNull();
  });

  it("shows the reset notice for demo users", () => {
    renderWith({ ...base, is_demo: true });
    expect(
      screen.getByText("Demo workspace. Resets in 24 hours. Emails and notifications are off."),
    ).toBeTruthy();
  });

  it("counts down from the workspace expiry when known", () => {
    const now = Date.UTC(2026, 2, 11, 5, 0);
    expect(hoursUntil(new Date(now + 5.5 * 3600e3).toISOString(), now)).toBe(6);
    expect(hoursUntil(new Date(now + 10 * 60e3).toISOString(), now)).toBe(1);
    expect(hoursUntil(undefined, now)).toBe(24);
    expect(hoursUntil("garbage", now)).toBe(24);
  });
});
