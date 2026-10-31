import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
vi.mock("hooks/useDemoLaunch", () => ({ useDemoLaunch: () => ({ launch: vi.fn(), isLoading: false, waking: false }) }));

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
  it("shows the pitch, sign-in, the live timeline and every section; no demo unless enabled", () => {
    flags.demo = false;
    renderLanding();
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Sign in" })[0].getAttribute("href")).toBe("/login");
    expect(screen.queryByRole("button", { name: "Try the demo" })).toBeNull();
    expect(screen.getByRole("group", { name: /Sample day/ })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Interactive sample team timeline" })).toBeTruthy();
    for (const title of [/recompute/, /after you sign in/, /overloaded/, /part of the org/, /Small stack/]) {
      expect(screen.getByRole("heading", { level: 2, name: title })).toBeTruthy();
    }
    // The demo section and its persona buttons only exist when the demo is on.
    expect(screen.queryByRole("heading", { name: /whole company/ })).toBeNull();
  });

  it("switches the app screenshots with the tabs", () => {
    flags.demo = false;
    renderLanding();
    const tab = screen.getByRole("tab", { name: "Task detail" });
    fireEvent.click(tab);
    expect(tab.getAttribute("aria-selected")).toBe("true");
    const img = within(screen.getByRole("tabpanel")).getByRole("img");
    expect(img.getAttribute("src")).toBe("/landing/task-detail.webp");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("width")).toBe("2000");
    fireEvent.keyDown(tab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Reports" }).getAttribute("aria-selected")).toBe("true");
  });

  it("offers the demo when enabled", () => {
    flags.demo = true;
    renderLanding();
    expect(screen.getAllByRole("button", { name: "Try the demo" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: /whole company/ })).toBeTruthy();
    for (const name of ["Manager", "Team lead", "Employee 1", "Employee 2"]) {
      expect(screen.getByRole("button", { name: `Explore as ${name}` })).toBeTruthy();
    }
  });

  it("points visitors who want Dayline for real at Request a workspace, not signup", () => {
    flags.demo = true;
    const { container } = renderLanding();
    const links = screen.getAllByRole("link", { name: /Request a workspace/ });
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l.getAttribute("href")).toBe("/request-workspace");
    expect(container.querySelector('a[href^="/onboarding"]')).toBeNull();
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
    expect(within(footer).getByRole("link", { name: /GitHub/ }).getAttribute("href")).toMatch(/^https:\/\/github\.com\/.+/);
    expect(within(footer).getByRole("link", { name: "Atif Moin" }).getAttribute("href")).toBe("https://portfolio.fullstackcity.in");
  });
});
