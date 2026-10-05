// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MouseEventHandler, ReactNode } from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: "fr-CM" },
  }),
}));

let pathname = "/";

vi.mock("@tanstack/react-router", () => ({
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname } }),
  Link: ({
    to,
    children,
    onClick,
    ...props
  }: {
    to: string;
    children?: ReactNode;
    onClick?: MouseEventHandler<HTMLAnchorElement>;
  }) => (
    <a
      href={to}
      {...props}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
    >
      {children}
    </a>
  ),
}));

vi.mock("../auth/me.js", () => ({
  useMeContext: () => ({
    principalId: "test-user",
    role: "FINANCE_APPROVER",
    enabledModules: ["CORE", "ASSETS", "ACTIVITIES", "FINANCE"],
  }),
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: (props: { "aria-label"?: string }) => (
    <button type="button" aria-label={props["aria-label"]} />
  ),
}));

import { RecordCrumbProvider, useRecordCrumb } from "./record-crumb.js";
import { SiteHeader } from "./SiteHeader.js";

const TRIP = "/activities/00000000-0000-4000-8000-000000000020";

/** Stands in for a detail screen that has loaded its record. */
function Publishes({ label }: { label: string }) {
  useRecordCrumb(label);
  return null;
}

/** [label, href] per crumb; href is null for the current page. */
function crumbs(): Array<[string, string | null]> {
  const nav = screen.getByRole("navigation", { name: "breadcrumb.label" });
  return within(nav)
    .getAllByRole("listitem")
    .filter((item) => item.getAttribute("data-slot") === "breadcrumb-item")
    .map((item) => {
      const link = item.querySelector("a");
      return [item.textContent ?? "", link?.getAttribute("href") ?? null];
    });
}

beforeEach(() => {
  pathname = "/";
});

afterEach(cleanup);

describe("SiteHeader breadcrumb", () => {
  it("shows Home alone on the dashboard, unlinked", () => {
    render(<SiteHeader />);

    expect(crumbs()).toEqual([["nav.home", null]]);
  });

  it("links Home and names the section on a list route", () => {
    pathname = "/assets";
    render(<SiteHeader />);

    expect(crumbs()).toEqual([
      ["nav.home", "/"],
      ["nav.assets", null],
    ]);
  });

  it("walks Home / Finance / Entries", () => {
    pathname = "/finance/entries";
    render(<SiteHeader />);

    expect(crumbs()).toEqual([
      ["nav.home", "/"],
      ["nav.finances", "/finance/entries"],
      ["finance.navigation.entries", null],
    ]);
  });

  it("gives an entry a fourth crumb that links back to the list", () => {
    pathname = "/finance/entries/00000000-0000-4000-8000-000000000010";
    render(<SiteHeader />);

    expect(crumbs()).toEqual([
      ["nav.home", "/"],
      ["nav.finances", "/finance/entries"],
      ["finance.navigation.entries", "/finance/entries"],
      ["finance.entries.detail.breadcrumb", null],
    ]);
  });

  it("names the record page even though it has no tab", () => {
    pathname = "/finance/record";
    render(<SiteHeader />);

    expect(crumbs()).toEqual([
      ["nav.home", "/"],
      ["nav.finances", "/finance/entries"],
      ["finance.navigation.record", null],
    ]);
  });

  it("walks Home / Trips / the trip's number", () => {
    pathname = TRIP;
    render(
      <RecordCrumbProvider>
        <SiteHeader />
        <Publishes label="TR-0042" />
      </RecordCrumbProvider>,
    );

    expect(crumbs()).toEqual([
      ["nav.home", "/"],
      ["nav.activities", "/activities"],
      ["TR-0042", null],
    ]);
  });

  it("says what the record is while the trip loads", () => {
    pathname = TRIP;
    render(
      <RecordCrumbProvider>
        <SiteHeader />
      </RecordCrumbProvider>,
    );

    expect(crumbs().at(-1)).toEqual(["activities.detail.breadcrumb", null]);
  });

  it("walks Home / Trips / Record a trip", () => {
    pathname = "/activities/record";
    render(<SiteHeader />);

    expect(crumbs()).toEqual([
      ["nav.home", "/"],
      ["nav.activities", "/activities"],
      ["commands.record-journey-sheet.label", null],
    ]);
  });

  it("marks the last crumb as the current page for assistive tech", () => {
    pathname = "/finance/periods";
    render(<SiteHeader />);

    const current = screen.getByText("finance.navigation.periods");
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(current.closest("a")).toBeNull();
  });

  it("keeps the divider a short centred tick, not a full-height rule", () => {
    const { container } = render(<SiteHeader />);

    const separator = container.querySelector('[data-slot="separator"]');
    // The vendored separator defaults to `data-vertical:self-stretch`, which
    // ran this the whole height of the header; dashboard-01 opts out.
    expect(separator?.className).toContain("h-4");
    expect(separator?.className).toContain("data-vertical:self-auto");
  });

  describe("on a phone", () => {
    const phoneCrumb = (container: HTMLElement) =>
      container.querySelector<HTMLElement>('[data-slot="breadcrumb-back"], [data-slot="breadcrumb-phone-page"]');

    it("keeps only the way back up on a vehicle, hiding the full trail and the tick", () => {
      pathname = "/assets/00000000-0000-4000-8000-00000000a001";
      const { container } = render(<SiteHeader />);

      const back = phoneCrumb(container);
      expect(back?.tagName).toBe("A");
      expect(back?.getAttribute("href")).toBe("/assets");
      expect(back?.textContent).toBe("nav.assets");
      expect(back?.className).toContain("md:hidden");
      expect(container.querySelector('[data-slot="breadcrumb-list"]')?.className).toContain("max-md:hidden");
      expect(container.querySelector('[data-slot="separator"]')?.className).toContain("max-md:hidden");
    });

    it("steps back to the list from an entry", () => {
      pathname = "/finance/entries/00000000-0000-4000-8000-000000000010";
      const { container } = render(<SiteHeader />);

      expect(phoneCrumb(container)?.getAttribute("href")).toBe("/finance/entries");
      expect(phoneCrumb(container)?.textContent).toBe("finance.navigation.entries");
    });

    it("steps back to Trips from a trip and from Record a trip", () => {
      for (const path of [TRIP, "/activities/record"]) {
        pathname = path;
        const { container, unmount } = render(<SiteHeader />);

        expect(phoneCrumb(container)?.getAttribute("href"), path).toBe("/activities");
        expect(phoneCrumb(container)?.textContent, path).toBe("nav.activities");
        unmount();
      }
    });

    it("names the section at its root, unlinked", () => {
      pathname = "/assets";
      const { container } = render(<SiteHeader />);

      const page = phoneCrumb(container);
      expect(page?.tagName).toBe("SPAN");
      expect(page?.textContent).toBe("nav.assets");
      expect(page?.getAttribute("aria-current")).toBe("page");
    });
  });

  it("replaces the old plain section title", () => {
    pathname = "/assets";
    render(<SiteHeader />);

    // The header is wayfinding only; screens still own the page <h1>.
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
