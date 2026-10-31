import { describe, it, expect, vi, Mock } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import { schedulerReducer } from "app/slices/scheduler.slice";
import { useStartDemoMutation } from "Services/user.api";
import DemoPersonaPicker from "Components/Demo/DemoPersonaPicker";

vi.mock("Services/user.api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("Services/user.api")>();
  return { ...actual, useStartDemoMutation: vi.fn() };
});
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

const setup = (isLoading = false) => {
  const unwrap = vi.fn().mockResolvedValue({
    token: "tok",
    userData: { emp_id: "w-QB0003", emp_name: "Wren", emp_email: "w@x.com", emp_designation: "Tech Lead", is_demo: true },
    demo: { workspace_id: "w", persona: "team_lead", expires_at: "2026-03-12T05:00:00Z" },
  });
  const trigger = vi.fn(() => ({ unwrap }));
  (useStartDemoMutation as Mock).mockReturnValue([trigger, { isLoading }]);
  const store = configureStore({ reducer: { scheduler: schedulerReducer } });
  render(
    <Provider store={store}>
      <ChakraProvider>
        <MemoryRouter>
          <DemoPersonaPicker />
        </MemoryRouter>
      </ChakraProvider>
    </Provider>,
  );
  return { trigger };
};

describe("DemoPersonaPicker", () => {
  it("offers the four personas, each with what it sees", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Try the demo as" })).toBeTruthy();
    for (const name of [/^Manager/, /^Team lead/, /^Employee 1/, /^Employee 2/]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByText(/all 12 people/)).toBeTruthy();
  });

  it.each([
    [/^Manager/, "manager"],
    [/^Team lead/, "team_lead"],
    [/^Employee 1/, "employee_1"],
    [/^Employee 2/, "employee_2"],
  ])("launches %s as %s", async (name, persona) => {
    const { trigger } = setup();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name }));
    });
    expect(trigger).toHaveBeenCalledWith({ persona });
  });

  it("says the server is waking up when the request is slow", () => {
    vi.useFakeTimers();
    try {
      setup(true);
      expect(screen.queryByText(/Waking the server/)).toBeNull();
      act(() => vi.advanceTimersByTime(2500));
      expect(screen.getByText(/Waking the server/)).toBeTruthy();
      expect(screen.getByText(/up to a minute/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
