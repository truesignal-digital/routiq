// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("react-i18next", async () => {
  const actual = await vi.importActual("react-i18next");
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { resolvedLanguage: "en" },
    }),
    initReactI18next: {
      type: "3rdParty",
      init: () => {},
    },
  };
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));

let mockUseMeContextValue: any = undefined;
vi.mock("../auth/me.js", () => ({
  useMeContext: () => mockUseMeContextValue,
}));

vi.mock("../finance/usePeriods.js", () => ({
  usePeriods: () => ({
    data: undefined,
    isPending: true,
    isError: false,
  }),
}));

vi.mock("../finance/permissions.js", () => ({
  canManagePeriods: () => false,
  canApproveEntries: () => false,
}));

vi.mock("../finance/FinanceNav.js", () => ({
  FinanceNav: () => null,
}));

import { FinancePeriodsScreen } from "./FinancePeriodsScreen.js";

describe("FinancePeriodsScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state while me is undefined (before guard can decide denied)", () => {
    mockUseMeContextValue = undefined;

    render(<FinancePeriodsScreen />);

    expect(screen.getByText("finance.periods.loading")).toBeTruthy();
    expect(screen.queryByText("finance.periods.accessDenied")).toBeNull();
  });

  it("shows access denied state after me loads and user lacks permission", () => {
    mockUseMeContextValue = {
      principalId: "test-user",
      role: "VIEWER",
      enabledModules: [],
    };

    render(<FinancePeriodsScreen />);

    expect(screen.getByText("finance.periods.accessDenied")).toBeTruthy();
    expect(screen.queryByText("finance.periods.loading")).toBeNull();
  });
});
