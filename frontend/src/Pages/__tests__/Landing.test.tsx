import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import { schedulerReducer, setCurrentUser } from "app/slices/scheduler.slice";
import Landing from "Pages/Landing";

const flags = vi.hoisted(() => ({ demo: false }));
vi.mock("Utils/constants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("Utils/constants")>();
  return {
    ...actual,
    get DEMO_ENABLED() {
      return flags.demo;
    },
  };
});
vi.mock("Components/Demo/DemoLauncher", () => ({ default: () => <button>Try the demo</button> }));

const renderLanding = (signedIn = false) => {
  const store = configureStore({ reducer: { scheduler: schedulerReducer } });
  if (signedIn) {
    store.dispatch(setCurrentUser({ emp_id: "a", emp_name: "A", emp_email: "a@x.com", emp_designation: "Eng" }));
  }
  return render(
    <Provider store={store}>
      <ChakraProvider>
        <MemoryRouter>
          <Landing />
        </MemoryRouter>
      </ChakraProvider>
    </Provider>,
  );
};

describe("Landing", () => {
  it("shows the pitch, sign-in and the real timeline preview; no demo unless enabled", () => {
    flags.demo = false;
    renderLanding();
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Sign in" })[0].getAttribute("href")).toBe("/login");
    expect(screen.queryByRole("button", { name: "Try the demo" })).toBeNull();
    expect(screen.getByRole("figure", { name: /Sample day/ })).toBeTruthy();
    for (const step of ["Pick", "Hold", "Resume", "Done"]) {
      expect(screen.getByRole("heading", { name: step })).toBeTruthy();
    }
  });

  it("offers the demo when enabled", () => {
    flags.demo = true;
    renderLanding();
    expect(screen.getAllByRole("button", { name: "Try the demo" }).length).toBeGreaterThan(0);
  });

  it("gives signed-in visitors an Open app button to /app", () => {
    flags.demo = false;
    renderLanding(true);
    expect(screen.getAllByRole("link", { name: "Open app" })[0].getAttribute("href")).toBe("/app");
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });

  it("has the footer credits", () => {
    flags.demo = false;
    renderLanding();
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: /GitHub/ }).getAttribute("href")).toMatch(/^https:\/\/github\.com\//);
    expect(within(footer).getByRole("link", { name: "Atif Moin" }).getAttribute("href")).toBe("https://portfolio.fullstackcity.in");
  });
});
