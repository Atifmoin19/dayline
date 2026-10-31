import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import { schedulerReducer } from "app/slices/scheduler.slice";
import { useStartDemoMutation } from "Services/user.api";
import DemoLauncher from "Components/Demo/DemoLauncher";

vi.mock("Services/user.api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("Services/user.api")>();
  return { ...actual, useStartDemoMutation: vi.fn() };
});
const navigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigate };
});

const setup = (isLoading = false) => {
  const unwrap = vi.fn().mockResolvedValue({
    token: "tok",
    userData: { emp_id: "w-QB0001", emp_name: "Odile", emp_email: "o@x.com", emp_designation: "CTO", is_demo: true },
    demo: { workspace_id: "w", persona: "manager", expires_at: "2026-03-12T05:00:00Z" },
  });
  const trigger = vi.fn(() => ({ unwrap }));
  (useStartDemoMutation as Mock).mockReturnValue([trigger, { isLoading }]);
  const store = configureStore({ reducer: { scheduler: schedulerReducer } });
  render(
    <Provider store={store}>
      <ChakraProvider>
        <MemoryRouter>
          <DemoLauncher />
        </MemoryRouter>
      </ChakraProvider>
    </Provider>,
  );
  return { store, trigger };
};

describe("DemoLauncher", () => {
  beforeEach(() => navigate.mockReset());

  it("starts a manager demo, signs in and goes home", async () => {
    const { store, trigger } = setup();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try the demo" }));
    });
    expect(trigger).toHaveBeenCalledWith({ persona: "manager" });
    const s = store.getState().scheduler;
    expect(s.token).toBe("tok");
    expect(s.currentUser?.is_demo).toBe(true);
    expect(s.currentUser?.demo_expires_at).toBe("2026-03-12T05:00:00Z");
    expect(navigate).toHaveBeenCalledWith("/app", { replace: true });
  });

  it("offers an employee persona", async () => {
    const { trigger } = setup();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /as an employee/i }));
    });
    expect(trigger).toHaveBeenCalledWith({ persona: "employee_1" });
  });

  it("says the server is waking up when the request is slow", () => {
    vi.useFakeTimers();
    try {
      setup(true);
      expect(screen.queryByText(/Waking the server/)).toBeNull();
      act(() => vi.advanceTimersByTime(2500));
      expect(screen.getByText(/Waking the server/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
