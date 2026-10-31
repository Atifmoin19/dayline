import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import AssigneeSuggestions from "Components/Timeline/AssigneeSuggestions";
import { useAssigneeSuggestionsQuery } from "Services/user.api";
import { AssigneeSuggestion, Employee } from "types";

// Only `useAssigneeSuggestionsQuery` is mocked — everything else stays real.
vi.mock("Services/user.api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("Services/user.api")>();
  return { ...actual, useAssigneeSuggestionsQuery: vi.fn() };
});

const mockedQuery = useAssigneeSuggestionsQuery as unknown as Mock;

const developers: Employee[] = [
  { emp_id: "s001", emp_name: "Rowan Achterberg", emp_email: "rowan@x.com", emp_designation: "SWE" },
  { emp_id: "s002", emp_name: "Lena Varga", emp_email: "lena@x.com", emp_designation: "QA" },
];

const suggestions: AssigneeSuggestion[] = [
  { emp_id: "s001", emp_name: "Rowan Achterberg", score: 42, reasons: ["0% utilized today", "Skills match: React"] },
  { emp_id: "s002", emp_name: "Lena Varga", score: 30, reasons: ["QA-focused role"] },
];

const renderSuggestions = (
  overrides: Partial<React.ComponentProps<typeof AssigneeSuggestions>> = {},
) => {
  const onSelect = vi.fn();
  const utils = render(
    <ChakraProvider>
      <AssigneeSuggestions
        tags=""
        priority=""
        title=""
        description=""
        developers={developers}
        selectedId={undefined}
        onSelect={onSelect}
        {...overrides}
      />
    </ChakraProvider>,
  );
  return { ...utils, onSelect };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  mockedQuery.mockReset();
  mockedQuery.mockReturnValue({ data: suggestions, isFetching: false, isError: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AssigneeSuggestions", () => {
  it("renders avatar-only chips with no visible name text, and exposes the name via aria-label", () => {
    renderSuggestions();

    // No name/reason text rendered as plain visible text — only in the accessible name.
    expect(screen.queryByText("Rowan Achterberg")).not.toBeInTheDocument();
    expect(screen.queryByText("0% utilized today")).not.toBeInTheDocument();

    const chip = screen.getByRole("button", {
      name: "Rowan Achterberg — 0% utilized today",
    });
    expect(chip).toBeInTheDocument();
  });

  it("falls back to just the name when a candidate has no reasons", () => {
    mockedQuery.mockReturnValue({
      data: [{ emp_id: "s003", emp_name: "No Reason Guy", score: 10, reasons: [] }],
      isFetching: false,
      isError: false,
    });
    renderSuggestions();

    expect(screen.getByRole("button", { name: "No Reason Guy" })).toBeInTheDocument();
  });

  it("calls onSelect with the candidate's emp_id when a chip is clicked", () => {
    const { onSelect } = renderSuggestions();

    fireEvent.click(screen.getByRole("button", { name: "Rowan Achterberg — 0% utilized today" }));
    expect(onSelect).toHaveBeenCalledWith("s001");
  });

  it("renders nothing when the query errors", () => {
    mockedQuery.mockReturnValue({ data: undefined, isFetching: false, isError: true });
    renderSuggestions();
    expect(screen.queryByText(/Suggested/)).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("renders nothing when not fetching and there are no suggestions", () => {
    mockedQuery.mockReturnValue({ data: [], isFetching: false, isError: false });
    renderSuggestions();
    expect(screen.queryByText(/Suggested/)).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("shows skeleton placeholders while fetching", () => {
    mockedQuery.mockReturnValue({ data: undefined, isFetching: true, isError: false });
    renderSuggestions();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("sends title and description straight through (no debounce), unlike tags which debounce", () => {
    renderSuggestions({ tags: "backend", title: "Fix login bug", description: "Already blurred text" });

    // Before the tags debounce fires, the query should have been called at least once with
    // undebounced tags but live title/description passed straight through.
    const lastCallBeforeDebounce = mockedQuery.mock.calls[mockedQuery.mock.calls.length - 1][0];
    expect(lastCallBeforeDebounce.title).toBe("Fix login bug");
    expect(lastCallBeforeDebounce.description).toBe("Already blurred text");

    vi.advanceTimersByTime(400);

    const lastCallAfterDebounce = mockedQuery.mock.calls[mockedQuery.mock.calls.length - 1][0];
    expect(lastCallAfterDebounce.tags).toBe("backend");
    expect(lastCallAfterDebounce.title).toBe("Fix login bug");
    expect(lastCallAfterDebounce.description).toBe("Already blurred text");
  });

  it("omits title/description from the query args when empty", () => {
    renderSuggestions();
    const lastCall = mockedQuery.mock.calls[mockedQuery.mock.calls.length - 1][0];
    expect(lastCall.title).toBeUndefined();
    expect(lastCall.description).toBeUndefined();
  });

  it("shows a short, context-aware heading depending on which signal is active", () => {
    const { rerender } = render(
      <ChakraProvider>
        <AssigneeSuggestions
          tags=""
          priority=""
          title=""
          description=""
          developers={developers}
          onSelect={vi.fn()}
        />
      </ChakraProvider>,
    );
    expect(screen.getByText("Suggested")).toBeInTheDocument();

    rerender(
      <ChakraProvider>
        <AssigneeSuggestions
          tags=""
          priority=""
          title=""
          description="A real description"
          developers={developers}
          onSelect={vi.fn()}
        />
      </ChakraProvider>,
    );
    expect(screen.getByText("Suggested (skill match)")).toBeInTheDocument();
  });
});
