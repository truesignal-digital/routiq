// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MouseEventHandler, ReactNode } from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: "fr-CM" },
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname: "/finance/entries" } }),
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

vi.mock("./useApprovals.js", () => ({
  useApprovals: () => ({ data: { total: 0 } }),
}));

import { FinanceToolbar } from "./FinanceToolbar.js";

afterEach(cleanup);

describe("FinanceToolbar", () => {
  it("puts the tabs and the controls on one row", () => {
    const { container } = render(
      <FinanceToolbar>
        <button type="button">Affichage</button>
      </FinanceToolbar>,
    );

    const row = container.firstElementChild;
    expect(row?.className).toContain("flex");
    expect(row?.className).toContain("justify-between");

    const tabs = screen.getByRole("tablist");
    const control = screen.getByRole("button", { name: "Affichage" });
    expect(row?.contains(tabs)).toBe(true);
    expect(row?.contains(control)).toBe(true);
  });

  it("still shows the tabs when a screen has no controls to offer", () => {
    render(<FinanceToolbar />);

    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
