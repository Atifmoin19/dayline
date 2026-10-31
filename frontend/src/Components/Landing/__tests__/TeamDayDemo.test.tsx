import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import TeamDayDemo from "Components/Landing/TeamDayDemo";
import HeroTimeline from "Components/Landing/HeroTimeline";

const renderIt = (ui: React.ReactElement) => render(<ChakraProvider>{ui}</ChakraProvider>);

describe("TeamDayDemo", () => {
  it("draws the sample team from calculateSchedule and recomputes on pick", () => {
    renderIt(<TeamDayDemo />);
    const timeline = screen.getByRole("group", { name: "Interactive sample team timeline" });
    expect(within(timeline).getAllByText(/Mira|Tomas|Juno|Deniz/).length).toBeGreaterThanOrEqual(4);
    expect(within(timeline).queryByText(/^Invoice PDF rendering, /)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Pick Invoice PDF rendering" }));
    // A new session bar appears, and Tomas's previous running task is auto-held.
    expect(within(timeline).getByText(/^Invoice PDF rendering, Medium priority, in progress/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resume Proration: unit tests for edge dates" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "What just happened" }).textContent).toMatch(/auto-held/);
  });

  it("clicking a bar applies the next action and the 30 minute skip runs the overdue sweep", () => {
    renderIt(<TeamDayDemo />);
    const timeline = screen.getByRole("group", { name: "Interactive sample team timeline" });
    const live = within(timeline).getAllByText(/^New bottom navigation.*Click to put it on hold/);
    fireEvent.click(live[live.length - 1].closest("li")!);
    expect(screen.getByRole("button", { name: "Resume New bottom navigation" })).toBeTruthy();

    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: /30 min/ }));
    expect(screen.getByRole("list", { name: "What just happened" }).textContent).toMatch(/Billing settings page.*backlog/);
    expect(screen.queryByRole("button", { name: "Pick Billing settings page" })).toBeTruthy();
  });

  it("ends the day at 19:00 with open sessions auto-held", () => {
    renderIt(<TeamDayDemo />);
    for (let i = 0; i < 12; i++) fireEvent.click(screen.getByRole("button", { name: /30 min/ }));
    expect(screen.getByRole("status").textContent).toMatch(/19:00/);
    expect(screen.queryAllByRole("button", { name: /^Hold / })).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getAllByRole("button", { name: /^Hold / }).length).toBe(4);
  });
});

describe("HeroTimeline", () => {
  it("shows the sample day and details for the hovered bar", () => {
    renderIt(<HeroTimeline />);
    const fig = screen.getByRole("group", { name: "Sample day on the Dayline timeline" });
    const bar = within(fig).getByText(/^Design invoice data model, High priority, done, 10:00 to 11:45/).closest("li")!;
    fireEvent.mouseEnter(bar);
    expect(screen.getByText("Design invoice data model", { selector: ".dl-window__task" })).toBeTruthy();
  });
});
