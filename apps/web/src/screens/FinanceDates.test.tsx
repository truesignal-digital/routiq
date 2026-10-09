// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FinancialEntryDetail } from "@routiq/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { sessionStore } from "../auth/store.js";
import { i18n } from "../i18n/index.js";
import { router as applicationRouter } from "../router.js";
import { entryVehicleFields } from "../test-entry-fields.js";

const entry: FinancialEntryDetail = {
  id: "00000000-0000-4000-8000-000000000010",
  entryNumber: "FIN-001",
  direction: "EXPENSE",
  status: "POSTED",
  category: { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel", layer: null },
  amountMinor: 1000,
  currency: "XAF",
  economicDate: "2026-01-01",
  postingPeriodCode: "2026-01",
  isLatePosting: false,
  branchId: "00000000-0000-4000-8000-000000000020",
  counterpartyName: null,
  paymentMethod: "CASH",
  estimateStatus: "ACTUAL",
  postedAt: "2026-01-01T00:30:00.000Z",
  rowVersion: 1,
  description: null,
  paymentReference: null,
  sourceReference: null,
  rejectedReason: null,
  reversesEntryId: null,
  reversedByEntryId: null,
  cancellation: null,
  ...entryVehicleFields,
  evidenceFiles: [],
  directionDecides: false,
  postings: [],
};

const identity = { username: "date-test", workspaceSlug: "date-test" };
let client: QueryClient;

afterEach(async () => {
  cleanup();
  client?.clear();
  sessionStore.logout(identity);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
  await i18n.changeLanguage("fr-CM");
});

function serveFinanceReadFixtures() {
  const ledgerRequests: URL[] = [];
  // The HTTP boundary is the only stub: routing, reads, translations and UI are real.
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    let body: unknown;
    switch (url.pathname) {
      case "/v1/me":
        body = {
          workspaceId: "00000000-0000-4000-8000-000000000001",
          principalId: "00000000-0000-4000-8000-000000000002",
          membershipId: "00000000-0000-4000-8000-000000000003",
          principalType: "HUMAN",
          displayName: "Sali Ahmadou",
          workspaceName: "Transports Ngwa",
          role: "ADMIN",
          branchScope: "ALL",
          enabledModules: ["CORE", "FINANCE"],
          enabledPresets: ["TRUCKING", "PASSENGER_TRANSPORT"],
        };
        break;
      case "/v1/reference/asset-registration":
        body = { assetClasses: [], branches: [{ id: entry.branchId, code: "DLA", name: "Douala" }] };
        break;
      case "/v1/assets":
        body = { items: [], nextCursor: null };
        break;
      case "/v1/finance/approvals":
        body = { entries: [], nextCursor: null, total: 0, outsideBranchCount: 0 };
        break;
      case "/v1/finance/summary":
        body = {
          currency: "XAF", month: "2026-09", openPeriodCode: "2026-09", lastLockedPeriodCode: null,
          outMinor: 0, inMinor: 0, missingReceipt: { count: 0, oldestEconomicDate: null }, waiting: null,
        };
        break;
      case "/v1/finance/entries":
        ledgerRequests.push(url);
        body = { entries: [entry], nextCursor: null };
        break;
      case `/v1/finance/entries/${entry.id}`:
        body = entry;
        break;
      default:
        throw new Error(`Unexpected request: ${url.pathname}`);
    }
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return ledgerRequests;
}

const languages = [
  {
    locale: "fr-CM",
    date: "01/01/2026",
    chicagoPostingDate: "31/12/2025",
    economicLabel: "Date comptable",
    postingLabel: "Date de comptabilisation",
    fullScreen: "Ouvrir en plein écran",
    detailHeading: "Détail de l'écriture",
    periodPlaceholder: "Période (AAAA-MM)",
  },
  {
    locale: "en",
    date: "1/1/26",
    chicagoPostingDate: "12/31/25",
    economicLabel: "Economic date",
    postingLabel: "Posting date",
    fullScreen: "Open full screen",
    detailHeading: "Entry detail",
    periodPlaceholder: "Period (YYYY-MM)",
  },
];

const viewers = languages.flatMap((language) =>
  ["Africa/Douala", "UTC", "America/Chicago"].map((zone) => ({
    ...language,
    zone,
    postingDate: zone === "America/Chicago" ? language.chicagoPostingDate : language.date,
  })),
);

it.each(viewers)("preserves financial dates through list, drawer, detail and filter in $locale / $zone", async (viewer) => {
  vi.stubEnv("TZ", viewer.zone);
  expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(viewer.zone);
  // jsdom does not implement the browser scrolling used by route navigation.
  vi.stubGlobal("scrollTo", vi.fn());
  await i18n.changeLanguage(viewer.locale);
  sessionStore.save({ ...identity, token: "disposable-test-token", expiresAt: "2099-01-01T00:00:00Z" });
  const ledgerRequests = serveFinanceReadFixtures();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree: applicationRouter.routeTree,
    history: createMemoryHistory({ initialEntries: ["/finance/entries"] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();

  const row = await screen.findByRole("row", { name: /FIN-001/ });
  const headers = screen.getAllByRole("columnheader");
  const cells = within(row).getAllByRole("cell");
  const economicColumn = headers.indexOf(
    screen.getByRole("columnheader", { name: viewer.economicLabel }),
  );
  const postingColumn = headers.indexOf(
    screen.getByRole("columnheader", { name: viewer.postingLabel }),
  );
  expect(cells[economicColumn]?.textContent).toBe(viewer.date);
  expect(cells[postingColumn]?.textContent).toBe(viewer.postingDate);

  await user.type(screen.getByPlaceholderText(viewer.periodPlaceholder), "2026-01");
  await waitFor(() => {
    expect(ledgerRequests.at(-1)?.searchParams.get("periodCode")).toBe("2026-01");
  });

  await user.click(await screen.findByRole("button", { name: "FIN-001" }));
  const drawer = await screen.findByRole("dialog", { name: "FIN-001" });
  expect(within(drawer).getByText(`${viewer.economicLabel} ${viewer.date}`)).toBeTruthy();
  expect(
    within(drawer).getByText(viewer.economicLabel, { selector: "dt" }).nextElementSibling?.textContent,
  ).toBe(viewer.date);
  expect(
    within(drawer).getByText(viewer.postingLabel, { selector: "dt" }).nextElementSibling?.textContent,
  ).toBe(viewer.postingDate);

  await user.click(within(drawer).getByRole("button", { name: viewer.fullScreen }));
  await screen.findByRole("heading", { name: viewer.detailHeading });
  expect(
    screen.getByText(viewer.economicLabel, { selector: "dt" }).nextElementSibling?.textContent,
  ).toBe(viewer.date);
  expect(
    screen.getByText(viewer.postingLabel, { selector: "dt" }).nextElementSibling?.textContent,
  ).toBe(viewer.postingDate);
});
