// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MouseEventHandler, ReactNode } from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${String(options.count)}`,
    i18n: { resolvedLanguage: "fr-CM" },
  }),
}));

let pathname = "/finance/entries";
const navigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname } }),
  // jsdom cannot follow a real anchor, so the default is suppressed — but Base
  // UI's own click handler is threaded through, since that is what activates
  // the tab.
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
    enabledModules: ["CORE", "FINANCE"],
  }),
}));

let approvalsTotal = 0;
vi.mock("./useApprovals.js", () => ({
  useApprovals: () => ({ data: { total: approvalsTotal } }),
}));

import { FinanceNav } from "./FinanceNav.js";

/** The tab whose aria-selected is true, read back by its label. */
function activeTabName(): string | undefined {
  return screen
    .getAllByRole("tab")
    .find((tab) => tab.getAttribute("aria-selected") === "true")
    ?.textContent ?? undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  pathname = "/finance/entries";
  approvalsTotal = 0;
});

afterEach(cleanup);

describe("FinanceNav", () => {
  it("lights exactly the tab owning the current route", () => {
    const routes = [
      ["/finance/entries", "finance.navigation.entries"],
      ["/finance/approvals", "finance.navigation.approvals"],
      ["/finance/periods", "finance.navigation.periods"],
    ] as const;

    for (const [route, expected] of routes) {
      pathname = route;
      render(<FinanceNav />);

      expect(activeTabName()).toBe(expected);
      expect(
        screen.getAllByRole("tab").filter(
          (tab) => tab.getAttribute("aria-selected") === "true",
        ),
      ).toHaveLength(1);

      cleanup();
    }
  });

  it("keeps Écritures active on an entry's own route", () => {
    pathname = "/finance/entries/00000000-0000-4000-8000-000000000010";
    render(<FinanceNav />);

    expect(activeTabName()).toBe("finance.navigation.entries");
  });

  it("selects nothing outside the finance subtree", () => {
    pathname = "/assets";
    render(<FinanceNav />);

    expect(activeTabName()).toBeUndefined();
  });

  it("renders each tab as a link to its own route", () => {
    render(<FinanceNav />);

    expect(
      screen
        .getAllByRole("tab")
        .map((tab) => tab.getAttribute("href")),
    ).toEqual(["/finance/entries", "/finance/approvals", "/finance/periods"]);
  });

  it("offers three tabs — recording is an action, not a section", () => {
    render(<FinanceNav />);

    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(
      screen.queryByRole("tab", { name: /finance\.navigation\.record/ }),
    ).toBeNull();
  });

  it("selects no tab on the record route", () => {
    pathname = "/finance/record";
    render(<FinanceNav />);

    // Reached from « Saisir une écriture », so no tab owns it — and nothing throws.
    expect(activeTabName()).toBeUndefined();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("navigates on keyboard activation of another tab", () => {
    render(<FinanceNav />);

    screen.getByRole("tab", { name: "finance.navigation.periods" }).click();

    expect(navigate).toHaveBeenCalledWith({ to: "/finance/periods" });
  });

  it("badges the pending approvals count inside the approvals tab", () => {
    approvalsTotal = 3;
    render(<FinanceNav />);

    const badge = screen.getByLabelText("finance.navigation.approvalsBadge:3");
    expect(badge.textContent).toBe("3");
    // The block renders the count as a Badge pill within the trigger itself.
    expect(badge.getAttribute("data-slot")).toBe("badge");
    expect(
      screen
        .getByRole("tab", { name: /finance\.navigation\.approvals/ })
        .contains(badge),
    ).toBe(true);
  });

  describe("stock pill rendering", () => {
    it("keeps the muted strip one continuous box", () => {
      render(<FinanceNav />);
      const list = screen.getByRole("tablist");

      expect(list.className).toContain("bg-muted");
      expect(list.className).toContain("rounded-lg");
      // The stock height and our override must collapse to one class, or the
      // winner is left to CSS source order. (The vertical height is separate.)
      expect(
        list.className
          .split(/\s+/)
          .filter((c) => c.startsWith("group-data-horizontal/tabs:h-")),
      ).toEqual(["group-data-horizontal/tabs:h-11"]);
    });

    it("never lets a trigger set its own height", () => {
      render(<FinanceNav />);

      // A trigger is sized by the strip via h-[calc(100%-1px)]. Giving it a
      // height of its own paints the active pill past the strip's edges.
      for (const tab of screen.getAllByRole("tab")) {
        expect(tab.className).toContain("h-[calc(100%-1px)]");
        expect(tab.className).not.toMatch(/(^|\s)min-h-/);
      }
    });

    it("raises the active tab with the stock pill classes", () => {
      render(<FinanceNav />);
      const active = screen
        .getAllByRole("tab")
        .find((tab) => tab.getAttribute("aria-selected") === "true");

      // Present even though the trigger renders as a Link.
      expect(active?.hasAttribute("data-active")).toBe(true);
      expect(active?.className).toContain("data-active:bg-background");
      expect(active?.className).toContain(
        "group-data-[variant=default]/tabs-list:data-active:shadow-sm",
      );
      expect(active?.className).toContain("rounded-md");
    });
  });

  it("badges no tab when nothing is pending", () => {
    approvalsTotal = 0;
    const { container } = render(<FinanceNav />);

    expect(container.querySelector('[data-slot="badge"]')).toBeNull();
  });
});
