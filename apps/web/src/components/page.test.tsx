// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { i18n } from "../i18n/index.js";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "./page.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Drops or restores the connection the way the browser reports it. */
function setOnline(online: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
  act(() => {
    window.dispatchEvent(new Event(online ? "online" : "offline"));
  });
}

describe("page scaffolds", () => {
  it("PageHeader renders its title and right-slot actions", () => {
    render(
      <PageHeader
        title="Asset documents"
        actions={<button type="button">Add document</button>}
      />,
    );

    expect(screen.getByRole("heading", { name: "Asset documents" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add document" })).toBeTruthy();
  });

  it("PageHeader puts its one-sentence description under the title, in the header", () => {
    render(<PageHeader title="Branches" description="Each branch has its own team." />);

    const description = screen.getByText("Each branch has its own team.");
    expect(description.closest("header")).toBe(screen.getByRole("banner"));
    expect(description.className).toContain("max-w-lg");
  });

  // jsdom has no layout, so this pins the classes; the 390 px width itself is
  // measured in the running app by `pnpm verify drive flow:phone-overflow`.
  it("PageHeader stacks actions under the title on phone and lets them wrap (#183)", () => {
    render(
      <PageHeader
        title="Maintenance"
        actions={
          <>
            <button type="button">Report a problem</button>
            <button type="button">New work order</button>
          </>
        }
      />,
    );

    const actions = screen.getByRole("button", { name: "New work order" }).parentElement;
    const row = actions?.parentElement;
    const classes = (el: Element | null | undefined) => (el?.className ?? "").split(/\s+/);

    expect(classes(actions)).toContain("flex-wrap");
    expect(classes(actions)).not.toContain("shrink-0");
    expect(classes(row)).toContain("flex-col");
    expect(classes(row)).toContain("sm:flex-row");
    expect(classes(row).filter((c) => c.startsWith("sm:") && c.includes("shrink-0"))).toEqual([]);
  });

  it("carries no back affordance — the SiteHeader breadcrumb is the way back", () => {
    render(<PageHeader title="Asset documents" />);

    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryAllByRole("link")).toEqual([]);
  });

  it("EmptyState renders its icon, message, and CTA callback", async () => {
    const onAction = vi.fn();

    render(
      <EmptyState
        icon={<svg data-testid="empty-icon" />}
        message="No documents yet."
        action={{ label: "Add document", onClick: onAction }}
      />,
    );

    expect(screen.getByTestId("empty-icon")).toBeTruthy();
    expect(screen.getByText("No documents yet.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Add document" }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("ErrorState renders its message and retry callback", async () => {
    const onRetry = vi.fn();

    render(
      <ErrorState message="The request failed." retryLabel="Try again" onRetry={onRetry} />,
    );

    expect(screen.getByRole("alert").textContent).toContain("The request failed.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("LoadingState renders the requested number of vendored skeletons", () => {
    const { container } = render(<LoadingState label="Loading…" rows={4} />);

    expect(screen.getByRole("status").textContent).toContain("Loading…");
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(4);
  });

  it("LoadingState says it waits for the connection instead of an endless skeleton (#576)", async () => {
    await i18n.changeLanguage("en");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <LoadingState label="Loading…" rows={4} />
      </I18nextProvider>,
    );

    expect(screen.getByRole("status").textContent).toContain(
      "You're offline. This will load as soon as the connection is back.",
    );
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);

    setOnline(true);
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(4);
    expect(screen.getByRole("status").textContent).not.toContain("offline");

    setOnline(false);
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);
  });

  it("LoadingState's offline words exist in French too", async () => {
    await i18n.changeLanguage("fr");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(
      <I18nextProvider i18n={i18n}>
        <LoadingState label="Chargement…" />
      </I18nextProvider>,
    );

    expect(screen.getByRole("status").textContent).toContain("Vous êtes hors ligne.");
    await i18n.changeLanguage("en");
  });
});
