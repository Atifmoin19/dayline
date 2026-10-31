import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import MiniTimeline from "Components/Landing/MiniTimeline";
import { buildSampleDay } from "Utils/landingSample";

describe("MiniTimeline", () => {
  it("renders the app's own calculateSchedule output for the static sample day", () => {
    const sample = buildSampleDay(new Date("2026-03-11T06:00:00Z"));
    const sessionCount = sample.tasks.reduce((n, t) => n + (t.task_sessions?.length || 0), 0);
    render(
      <ChakraProvider>
        <MiniTimeline sample={sample} />
      </ChakraProvider>,
    );
    for (const dev of sample.developers) expect(screen.getAllByText(dev.emp_name).length).toBeGreaterThan(0);
    const blocks = screen.getAllByRole("listitem");
    expect(blocks).toHaveLength(sessionCount);
    expect(screen.getByLabelText(/Rate-limit the public API, 10:00 to 12:30/)).toBeTruthy();
  });
});
