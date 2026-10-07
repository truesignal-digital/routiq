// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FinancialEntryDetail } from "@routiq/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { sessionStore } from "../auth/store.js";
import { i18n } from "../i18n/index.js";
import { router as applicationRouter } from "../router.js";
import { entryVehicleFields } from "../test-entry-fields.js";

const identity = { username: "executive-test", workspaceSlug: "executive-test" };
const branchId = "00000000-0000-4000-8000-000000000020";
const entry: FinancialEntryDetail = {
  id: "00000000-0000-4000-8000-000000000010",
  entryNumber: "FIN-EXEC", direction: "EXPENSE", status: "POSTED",
  category: { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel", layer: null },
  amountMinor: 25000, currency: "XAF", economicDate: "2026-09-04",
  postingPeriodCode: "2026-09", isLatePosting: false, branchId,
  counterpartyName: "Station Douala", paymentMethod: "CASH", estimateStatus: "ACTUAL",
  postedAt: "2026-09-04T12:00:00Z", rowVersion: 1,
  description: "Vehicle fuel", paymentReference: null, sourceReference: null,
  rejectedReason: null, reversesEntryId: null, reversedByEntryId: null, cancellation: null,
  ...entryVehicleFields,
  evidenceFiles: [], postings: [], directionDecides: false,
};
let client: QueryClient;

afterEach(async () => {
  cleanup();
  client?.clear();
  sessionStore.logout(identity);
  vi.unstubAllGlobals();
  localStorage.clear();
  await i18n.changeLanguage("fr-CM");
});

async function openFinance(path = "/finance/entries", options: { locale?: string; width?: number; financeEnabled?: boolean; listState?: "empty" | "error"; waitForLedger?: Promise<void> } = {}) {
  const requests: { url: URL; method: string }[] = [];
  vi.stubGlobal("scrollTo", vi.fn());
  const width = options.width ?? 1280;
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width") ? width >= 768 : width < 768,
    media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
  // Only the HTTP boundary is replaced; the application and permissions are real.
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    requests.push({ url, method: init?.method ?? "GET" });
    let body: unknown;
    switch (url.pathname) {
      case "/v1/me":
        body = {
          workspaceId: "00000000-0000-4000-8000-000000000001",
          principalId: "00000000-0000-4000-8000-000000000002",
          membershipId: "00000000-0000-4000-8000-000000000003",
          principalType: "HUMAN", role: "ADMIN", branchScope: [branchId],
          enabledModules: options.financeEnabled === false ? ["CORE"] : ["CORE", "FINANCE"],
          enabledPresets: ["TRUCKING", "PASSENGER_TRANSPORT"],
        };
        break;
      case "/v1/reference/asset-registration":
        body = { assetClasses: [], branches: [{ id: branchId, code: "DLA", name: "Douala" }] };
        break;
      case "/v1/assets":
        body = { items: [], nextCursor: null };
        break;
      case "/v1/finance/summary":
        body = {
          currency: "XAF", month: "2026-09", openPeriodCode: "2026-09", lastLockedPeriodCode: null,
          outMinor: 0, inMinor: 0, missingReceipt: { count: 0, oldestEconomicDate: null }, waiting: null,
        };
        break;
      case "/v1/finance/entries":
        await options.waitForLedger;
        if (options.listState === "error") return new Response(null, { status: 500 });
        body = { entries: options.listState === "empty" ? [] : [entry], nextCursor: null };
        break;
      case "/v1/dashboard":
        body = {
          assets: { total: 0, byStatus: { REGISTERED: 0, IN_SERVICE: 0, UNDER_MAINTENANCE: 0, SOLD: 0, RETIRED: 0, WRITTEN_OFF: 0 } },
          openPeriod: { periodCode: "2026-09", postedExpenseMinor: 25000, postedRevenueMinor: 0, currency: "XAF" },
          pendingApprovals: { count: 0, outsideBranchCount: 0 }, series: [],
        };
        break;
      case `/v1/finance/entries/${entry.id}`:
        body = entry;
        break;
      case `/v1/history/financial_entry/${entry.id}`:
        body = { items: [], nextCursor: null };
        break;
      default:
        throw new Error(`Unexpected request: ${url.pathname}`);
    }
    return new Response(JSON.stringify(body), { status: 200 });
  });
  await i18n.changeLanguage(options.locale ?? "en");
  sessionStore.save({ ...identity, token: "disposable-executive-token", expiresAt: "2099-01-01T00:00:00Z" });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createRouter({ routeTree: applicationRouter.routeTree, history });
  // Initial navigation is asynchronous. Flush its React updates before starting
  // DOM query deadlines; the cold CI render can exceed findBy's default wait.
  await act(async () => {
    render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  });
  return { requests, history };
}

const languages = [
  { locale: "en", money: "Money", waiting: "Waiting your approval", months: "Accounting months", fullScreen: "Open full screen", detail: "Entry detail", reverse: "Reverse", empty: "No entry recorded for this branch.", error: "We couldn't load entries. Please retry." },
  { locale: "fr-CM", money: "Argent", waiting: "En attente de votre approbation", months: "Mois comptables", fullScreen: "Ouvrir en plein écran", detail: "Détail de l'écriture", reverse: "Contre-passer", empty: "Aucune écriture pour cette agence.", error: "Impossible de charger les écritures. Réessayez." },
];
const viewers = languages.flatMap((language) => [390, 1280].map((width) => ({ ...language, width })));

// The Administrateur reads the books of their branches but takes no money
// decision (ADR-0009): no waiting view, no accounting months, no reversal.
it.each(viewers)("lets the Administrateur inspect the ledger and entry without money decisions ($locale, $width px)", async (viewer) => {
  const { requests } = await openFinance("/finance/entries", viewer);
  const user = userEvent.setup();
  const entryButton = await screen.findByRole("button", { name: "FIN-EXEC" });
  expect(screen.getByRole("heading", { level: 1, name: viewer.money })).toBeTruthy();
  expect(screen.queryByRole("button", { name: viewer.waiting })).toBeNull();
  expect(screen.queryByRole("link", { name: viewer.months })).toBeNull();

  await user.click(entryButton);
  const drawer = await screen.findByRole("dialog", { name: "FIN-EXEC" });
  expect(within(drawer).getByText("Station Douala")).toBeTruthy();
  await user.click(within(drawer).getByRole("button", { name: viewer.fullScreen }));
  await screen.findByRole("heading", { name: viewer.detail });
  expect(screen.queryByRole("button", { name: viewer.reverse })).toBeNull();
  expect(requests.every(({ method }) => method === "GET")).toBe(true);
  expect(requests.some(({ url }) => url.pathname === "/v1/finance/approvals")).toBe(false);
});

it.each(viewers)("renders empty and error states without money decisions ($locale, $width px)", async (viewer) => {
  await openFinance("/finance/entries", { ...viewer, listState: "empty" });
  await screen.findByText(viewer.empty);
  expect(screen.queryByRole("button", { name: viewer.waiting })).toBeNull();
  cleanup();
  client.clear();
  await openFinance("/finance/entries", { ...viewer, listState: "error" });
  await screen.findByText(viewer.error);
  expect(screen.queryByRole("button", { name: viewer.waiting })).toBeNull();
});

it.each(viewers)("shows loading without a false denial or money decisions ($locale, $width px)", async (viewer) => {
  let release = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const { requests } = await openFinance("/finance/entries", { ...viewer, waitForLedger: pending });
  await waitFor(() => expect(requests.some(({ url }) => url.pathname === "/v1/finance/entries")).toBe(true));
  expect(screen.getByText(viewer.locale === "en" ? "Loading…" : "Chargement…")).toBeTruthy();
  expect(screen.queryByRole("link", { name: viewer.months })).toBeNull();
  await act(async () => { release(); });
  await screen.findByRole("button", { name: "FIN-EXEC" });
});

it("does not expose a reversal form to an Administrateur following a direct reversal link", async () => {
  const { requests } = await openFinance(`/finance/entries/${entry.id}?reverse=true`);
  await screen.findByText("Station Douala");
  expect(screen.queryByRole("dialog", { name: "Reverse entry" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Reverse" })).toBeNull();
  expect(requests.every(({ method }) => method === "GET")).toBe(true);
});

it("opens a dashboard total in its period and retains branch/period after inspecting an entry", async () => {
  const { requests, history } = await openFinance("/");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("link", { name: "Period expense" }));
  await screen.findByRole("button", { name: "FIN-EXEC" });
  expect(screen.getByPlaceholderText("Period (YYYY-MM)").getAttribute("value")).toBe("2026-09");
  expect(history.location.search).toContain("direction=EXPENSE");
  expect(history.location.search).toContain("status=LEDGER");
  const period = screen.getByPlaceholderText("Period (YYYY-MM)");
  await user.clear(period);
  await user.type(period, "2026-08");
  await waitFor(() => expect(history.location.search).toContain("periodCode=2026-08"));
  await user.click(await screen.findByRole("button", { name: "FIN-EXEC" }));
  const drawer = await screen.findByRole("dialog", { name: "FIN-EXEC" });
  await user.click(within(drawer).getByRole("button", { name: "Open full screen" }));
  await screen.findByRole("heading", { name: "Entry detail" });
  await user.click(screen.getByRole("button", { name: "History" }));
  await screen.findByText("No history");
  await user.keyboard("{Escape}");
  await act(async () => { history.back(); });
  await screen.findByRole("button", { name: "FIN-EXEC" });
  expect(screen.getByPlaceholderText("Period (YYYY-MM)").getAttribute("value")).toBe("2026-08");
  await waitFor(() => expect(requests.some(({ url }) => url.pathname === "/v1/finance/entries" && url.searchParams.get("periodCode") === "2026-09")).toBe(true));
  expect(requests.filter(({ url }) => url.pathname === "/v1/finance/entries").every(({ url }) => url.searchParams.get("branchId") === branchId)).toBe(true);
});

it.each(["/finance/entries", `/finance/entries/${entry.id}`])("does not fetch financial records through a disabled-module direct link: %s", async (path) => {
  const { requests } = await openFinance(path, { financeEnabled: false });
  await screen.findByText("This module is not enabled for your workspace.");
  expect(screen.queryByText("FIN-EXEC")).toBeNull();
  expect(requests.some(({ url }) => url.pathname.startsWith("/v1/finance") || url.pathname.startsWith("/v1/history"))).toBe(false);
});
