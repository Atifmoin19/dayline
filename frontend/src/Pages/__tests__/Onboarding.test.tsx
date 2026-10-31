import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import { schedulerReducer } from "app/slices/scheduler.slice";
import Onboarding from "Pages/onboarding";

vi.mock("Services/user.api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("Services/user.api")>();
  return {
    ...actual,
    usePreviewOnboardingMutation: () => [vi.fn(), { isLoading: false }],
    useRegisterMutation: () => [vi.fn(), { isLoading: false }],
  };
});

const renderAt = (url: string) =>
  render(
    <Provider store={configureStore({ reducer: { scheduler: schedulerReducer } })}>
      <ChakraProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/request-workspace" element={<p>request page</p>} />
          </Routes>
        </MemoryRouter>
      </ChakraProvider>
    </Provider>,
  );

describe("Onboarding (invite link only)", () => {
  it("sends visitors without an invite to Request a workspace", () => {
    renderAt("/onboarding");
    expect(screen.getByText("request page")).toBeInTheDocument();
  });

  it("opens the first-login flow from an invite link, prefilled", () => {
    renderAt("/onboarding?emp_id=EMP042&email=new%40acme.example");
    expect(screen.getByRole("heading", { name: "Welcome to Dayline" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. EMP001")).toHaveValue("EMP042");
    expect(screen.getByDisplayValue("new@acme.example")).toBeInTheDocument();
  });
});
