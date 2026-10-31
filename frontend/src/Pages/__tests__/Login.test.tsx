import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import { schedulerReducer } from "app/slices/scheduler.slice";
import Login from "Pages/login";

const flags = vi.hoisted(() => ({ demo: true }));
vi.mock("Utils/constants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("Utils/constants")>();
  return {
    ...actual,
    get DEMO_ENABLED() {
      return flags.demo;
    },
  };
});
vi.mock("Services/user.api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("Services/user.api")>();
  return {
    ...actual,
    useLoginMutation: () => [vi.fn(), { isLoading: false }],
    useSsoStatusQuery: () => ({ data: { enabled: false } }),
  };
});
vi.mock("Components/Demo/DemoPersonaPicker", () => ({ default: () => <h2>Try the demo as</h2> }));

const renderLogin = () =>
  render(
    <Provider store={configureStore({ reducer: { scheduler: schedulerReducer } })}>
      <ChakraProvider>
        <MemoryRouter>
          <Login />
        </MemoryRouter>
      </ChakraProvider>
    </Provider>,
  );

describe("Login", () => {
  it("leads with the demo personas, then sign-in for invited teams", () => {
    flags.demo = true;
    const { container } = renderLogin();
    const picker = screen.getByRole("heading", { name: "Try the demo as" });
    const signIn = screen.getByRole("heading", { name: "Sign in (for invited teams)" });
    expect(picker.compareDocumentPosition(signIn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("link", { name: "Request a workspace" }).getAttribute("href")).toBe("/request-workspace");
    expect(container.querySelector('a[href^="/onboarding"]')).toBeNull();
  });

  it("hides the picker when the demo is off", () => {
    flags.demo = false;
    renderLogin();
    expect(screen.queryByRole("heading", { name: "Try the demo as" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Sign in (for invited teams)" })).toBeTruthy();
  });
});
