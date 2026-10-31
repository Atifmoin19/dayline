import React from "react";
import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { schedulerReducer, addTask, addDeveloper, setCurrentUser } from "app/slices/scheduler.slice";
import AIInsightPanel from "Components/AIInsightPanel";
import { useInsightsQuery } from "Services/user.api";
import { InsightsResponse } from "types";

// Only `useInsightsQuery` is mocked — the reducer/middleware exports of Services/user.api
// stay real (unused by this test's store, but importOriginal keeps the mock cheap/accurate).
vi.mock("Services/user.api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("Services/user.api")>();
  return { ...actual, useInsightsQuery: vi.fn() };
});

const mockOpenTaskDetail = vi.fn();
vi.mock("Contexts/useTaskDetail", () => ({
  useTaskDetail: () => ({ openTaskDetail: mockOpenTaskDetail, closeTaskDetail: vi.fn() }),
}));

const buildStore = () => {
  const store = configureStore({ reducer: { scheduler: schedulerReducer } });
  store.dispatch(
    setCurrentUser({ emp_id: "s001", emp_name: "Alice", emp_email: "a@x.com", emp_designation: "Eng" }),
  );
  store.dispatch(
    addDeveloper([
      { emp_id: "s001", emp_name: "Alice", emp_email: "a@x.com", emp_designation: "Eng" },
      { emp_id: "s002", emp_name: "Bob", emp_email: "b@x.com", emp_designation: "Eng" },
      { emp_id: "s003", emp_name: "Cara", emp_email: "c@x.com", emp_designation: "Eng" },
    ]),
  );
  store.dispatch(addTask([{ id: "t1", task_name: "Ship the release" }]));
  return store;
};

const renderPanel = () => {
  const store = buildStore();
  return render(
    <Provider store={store}>
      <ChakraProvider>
        <AIInsightPanel />
      </ChakraProvider>
    </Provider>,
  );
};

const mockedUseInsightsQuery = useInsightsQuery as unknown as Mock;

const baseInsights: InsightsResponse = {
  available: false,
  summary: null,
  recommendations: [],
  reason: "AI insight not configured (no GEMINI_API_KEY set).",
  generated_at: "2026-07-26T00:00:00Z",
  scope_employee_count: 3,
  at_risk_tasks: [],
  rebalance_suggestions: [],
};

beforeEach(() => {
  mockOpenTaskDetail.mockClear();
  mockedUseInsightsQuery.mockReset();
});

describe("AIInsightPanel", () => {
  it("shows the 'unavailable' empty state when Gemini isn't configured and there's nothing deterministic to show", () => {
    mockedUseInsightsQuery.mockReturnValue({ data: baseInsights, isLoading: false, isFetching: false, isError: false });
    renderPanel();

    expect(screen.getByText("AI insight unavailable")).toBeInTheDocument();
    expect(screen.queryByText("At-Risk Tasks")).not.toBeInTheDocument();
    expect(screen.queryByText("Rebalance Suggestions")).not.toBeInTheDocument();
  });

  it("renders at-risk tasks and rebalance suggestions even when available is false (the critical backend contract)", () => {
    mockedUseInsightsQuery.mockReturnValue({
      data: {
        ...baseInsights,
        at_risk_tasks: [
          { task_id: "t1", task_name: "Ship the release", assignee_emp_id: "s001", risk_level: "high", reason: "already past its due date" },
        ],
        rebalance_suggestions: [
          { overloaded_emp_id: "s002", idle_emp_id: "s003", reason: "s002 is over capacity (120%); s003 has headroom (20%)" },
        ],
      },
      isLoading: false,
      isFetching: false,
      isError: false,
    });
    renderPanel();

    // Gemini summary/recommendations still show the unavailable state...
    expect(screen.getByText("AI insight unavailable")).toBeInTheDocument();
    // ...but the two deterministic sections render independently of `available: false`.
    expect(screen.getByText("At-Risk Tasks")).toBeInTheDocument();
    expect(screen.getByText("Ship the release")).toBeInTheDocument();
    expect(screen.getByText("High risk")).toBeInTheDocument();
    expect(screen.getByText("Rebalance Suggestions")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Cara")).toBeInTheDocument();
  });

  it("opens the matching task's detail view when an at-risk row (whose task exists in the local Redux task list) is clicked", () => {
    mockedUseInsightsQuery.mockReturnValue({
      data: {
        ...baseInsights,
        at_risk_tasks: [
          { task_id: "t1", task_name: "Ship the release", assignee_emp_id: "s001", risk_level: "high", reason: "already past its due date" },
        ],
      },
      isLoading: false,
      isFetching: false,
      isError: false,
    });
    renderPanel();

    fireEvent.click(screen.getByText("Ship the release"));
    expect(mockOpenTaskDetail).toHaveBeenCalledWith(expect.objectContaining({ id: "t1", task_name: "Ship the release" }));
  });

  it("omits both sections cleanly when the arrays are empty, without an empty shell", () => {
    mockedUseInsightsQuery.mockReturnValue({
      data: { ...baseInsights, available: true, summary: "All clear.", recommendations: [] },
      isLoading: false,
      isFetching: false,
      isError: false,
    });
    renderPanel();

    expect(screen.getByText("All clear.")).toBeInTheDocument();
    expect(screen.queryByText("At-Risk Tasks")).not.toBeInTheDocument();
    expect(screen.queryByText("Rebalance Suggestions")).not.toBeInTheDocument();
  });
});
