import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { MemoryRouter } from "react-router-dom";
import RequestWorkspace from "Pages/RequestWorkspace";

const fetchMock = vi.fn();

const renderPage = () =>
  render(
    <ChakraProvider>
      <MemoryRouter>
        <RequestWorkspace />
      </MemoryRouter>
    </ChakraProvider>,
  );

const fill = (overrides: Partial<Record<string, string>> = {}) => {
  const values = {
    "Your name": "Ada Lovelace",
    "Work email": "ada@analytical.example",
    Company: "Analytical Engines",
    "What should we know?": "We are a team of 14 engineers and want to try timelines.",
    ...overrides,
  };
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } });
  }
  fireEvent.change(screen.getByLabelText("Team size", { exact: false }), { target: { value: "11-50" } });
};

const submit = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /send request/i }));
  });
};

const reply = (status: number, body: unknown = {}) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("RequestWorkspace", () => {
  it("puts labels above inputs and validates before sending", async () => {
    renderPage();
    await submit();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Tell us your name.")).toBeInTheDocument();
    expect(screen.getByText("Enter your work email.")).toBeInTheDocument();
    expect(screen.getByText("Tell us your company.")).toBeInTheDocument();
    expect(screen.getByText("Pick a team size.")).toBeInTheDocument();

    fill({ "Work email": "not-an-email" });
    await submit();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("That email doesn't look right.")).toBeInTheDocument();
  });

  it("posts the request to the contact API and thanks the visitor", async () => {
    fetchMock.mockReturnValue(reply(200, { sent: true }));
    renderPage();
    fill();
    await submit();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.fullstackcity.in/portfolio/contact");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@analytical.example",
      mobile: "",
      message: "We are a team of 14 engineers and want to try timelines.",
      company: "Analytical Engines",
      team_size: "11-50",
      source: "dayline",
      inquiry_type: "workspace_request",
      website: "",
    });
    expect(await screen.findByRole("heading", { name: /thanks, ada/i })).toBeInTheDocument();
    expect(screen.getByText(/ada@analytical.example/)).toBeInTheDocument();
  });

  it("explains a rate limit", async () => {
    fetchMock.mockReturnValue(reply(429, { detail: "Rate limit exceeded" }));
    renderPage();
    fill();
    await submit();
    expect(await screen.findByText(/a few requests already/i)).toBeInTheDocument();
  });

  it("maps server validation errors to the fields", async () => {
    fetchMock.mockReturnValue(
      reply(422, { detail: [{ loc: ["body", "email"], msg: "value is not a valid email address", type: "value_error" }] }),
    );
    renderPage();
    fill();
    await submit();
    expect(await screen.findByText("value is not a valid email address")).toBeInTheDocument();
    expect(screen.getByText(/check the highlighted fields/i)).toBeInTheDocument();
  });

  it("handles a network error and keeps what was typed", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    renderPage();
    fill();
    await submit();
    expect(await screen.findByText(/couldn't reach the server/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Company", { exact: false })).toHaveValue("Analytical Engines");
  });

  it("says the server is waking up when it is slow", async () => {
    vi.useFakeTimers();
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderPage();
    fill();
    await submit();
    expect(screen.queryByText(/waking the server/i)).toBeNull();
    act(() => vi.advanceTimersByTime(2500));
    expect(screen.getAllByText(/waking the server/i).length).toBeGreaterThan(0);
  });

  it("drops bot submissions that fill the hidden website field", async () => {
    const { container } = renderPage();
    fill();
    const honeypot = container.querySelector('input[name="website"]') as HTMLInputElement;
    expect(honeypot).toBeTruthy();
    expect(honeypot.tabIndex).toBe(-1);
    fireEvent.change(honeypot, { target: { value: "http://spam.example" } });
    await submit();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("heading", { name: /thanks/i })).toBeInTheDocument();
  });
});
