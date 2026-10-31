import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import InlineEditableText from "Components/Timeline/InlineEditableText";

const renderWithChakra = (ui: React.ReactElement) => render(<ChakraProvider>{ui}</ChakraProvider>);

describe("InlineEditableText", () => {
  it("renders the value as plain text in view mode", () => {
    renderWithChakra(<InlineEditableText value="Hello world" onCommit={vi.fn()} />);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows the empty label when value is blank", () => {
    renderWithChakra(<InlineEditableText value="" onCommit={vi.fn()} />);
    expect(screen.getByText("Add a description...")).toBeInTheDocument();
  });

  it("double-click switches to an editable input, focused with the current value", async () => {
    const user = userEvent.setup();
    renderWithChakra(<InlineEditableText value="Hello world" onCommit={vi.fn()} />);

    await user.dblClick(screen.getByText("Hello world"));

    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(input.value).toBe("Hello world");
  });

  it("Enter commits the edited value and returns to view mode", async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    renderWithChakra(<InlineEditableText value="Hello world" onCommit={onCommit} />);

    await user.dblClick(screen.getByText("Hello world"));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "Updated value{Enter}");

    expect(onCommit).toHaveBeenCalledWith("Updated value");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("Escape cancels the edit without committing, reverting to the original value", async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    renderWithChakra(<InlineEditableText value="Hello world" onCommit={onCommit} />);

    await user.dblClick(screen.getByText("Hello world"));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "Discarded edit{Escape}");

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("does not commit when the trimmed value is unchanged", async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    renderWithChakra(<InlineEditableText value="Hello world" onCommit={onCommit} />);

    await user.dblClick(screen.getByText("Hello world"));
    const input = screen.getByRole("textbox");
    await user.type(input, "{Enter}");

    expect(onCommit).not.toHaveBeenCalled();
  });
});
