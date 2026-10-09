import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, render } from "@testing-library/react";
import { vi } from "vitest";
import type {
  ActivityDetail,
  ActivityListItem,
  AssetAttentionItem,
  AssetDetail,
  AssetDocumentRead,
  AssetFinanceResponse,
  FinancialEntryDetail,
  FinancialEntryListItem,
  IssueDetail,
  IssueListItem,
  ModuleCode,
  NoteDetail,
  PrincipalType,
  Role,
  VehicleHistoryItem,
  WorkOrderDetail,
  WorkOrderListItem,
} from "@routiq/contracts";
import { sessionStore } from "../../auth/store.js";
import { i18n } from "../../i18n/index.js";
import { router as applicationRouter } from "../../router.js";
import { ALL_MODULES, ASSET_ID, BRANCH_ID, asset as assetFixture, finance as financeFixture, me } from "./fixtures.js";

export const identity = { username: "vehicle-test", workspaceSlug: "vehicle-test" };

export interface VehicleScenario {
  role: Role;
  /**
   * Members who can sign in through the login screen, by username; each gets
   * the token `token-<username>`, and `/v1/me` answers the role behind the
   * bearer token (`role` for the session the harness opens with).
   */
  members?: Record<string, Role>;
  modules?: ModuleCode[];
  principalType?: PrincipalType;
  width?: number;
  locale?: "en" | "fr-CM";
  asset?: AssetDetail;
  /**
   * The vehicle as successive reads find it — the first read gets the first,
   * the last repeats — for a change made elsewhere between two reads.
   */
  assetReads?: AssetDetail[];
  /** HTTP status for the vehicle read, when it should fail. */
  assetStatus?: number;
  /**
   * Keep the Query client's own retry defaults (three retries, backoff from
   * 1 s) instead of the harness's none-and-instant, to test a read's retry.
   */
  defaultRetries?: boolean;
  attention?: AssetAttentionItem[];
  /** HTTP status for the attention read, when it should fail. */
  attentionStatus?: number;
  /** The attention read answers only once this settles, to see the page while it loads. */
  attentionHeld?: Promise<unknown>;
  finance?: (periodCode: string | null) => AssetFinanceResponse;
  history?: VehicleHistoryItem[];
  historyNextCursor?: string | null;
  workOrders?: WorkOrderListItem[];
  workOrderDetails?: WorkOrderDetail[];
  issues?: IssueListItem[];
  issueDetails?: IssueDetail[];
  entries?: FinancialEntryListItem[];
  entryDetails?: FinancialEntryDetail[];
  trips?: ActivityListItem[];
  tripDetails?: ActivityDetail[];
  documents?: AssetDocumentRead[];
  notes?: NoteDetail[];
  /** What a command answers; defaults to a committed result. */
  command?: (name: string, body: CommandBody) => { status: number; body: unknown };
}

export interface CommandBody {
  version: number;
  envelope: Record<string, unknown>;
  payload: Record<string, unknown>;
}

export interface Recorded {
  requests: Array<{ url: URL; method: string }>;
  commands: Array<{ name: string; body: CommandBody }>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * Only the HTTP boundary is replaced: the application's router, shell,
 * permission helpers and the workspace itself are the real ones.
 */
export async function openVehicle(path: string, scenario: VehicleScenario) {
  const recorded: Recorded = { requests: [], commands: [] };
  const width = scenario.width ?? 1280;
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width") ? width >= 768 : width < 768,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  const vehicle = scenario.asset ?? assetFixture();
  let assetReadCount = 0;

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    recorded.requests.push({ url, method });
    const p = url.pathname;

    if (method === "POST" && p.startsWith("/v1/commands/")) {
      const name = decodeURIComponent(p.slice("/v1/commands/".length));
      const body = JSON.parse(String(init?.body)) as CommandBody;
      recorded.commands.push({ name, body });
      const answer = scenario.command?.(name, body) ?? {
        status: 200,
        body: {
          commandId: body.envelope["commandId"],
          recordId: "00000000-0000-4000-8000-0000000000f9",
          rowVersion: 2,
          warnings: [],
          idempotentReplay: false,
        },
      };
      return json(answer.body, answer.status);
    }

    if (p.endsWith("/download-url")) return json({ url: `https://files.test${p}` });

    const byId = <T extends { id: string }>(items: readonly T[] | undefined, id: string) =>
      items?.find((item) => item.id === id);
    const last = p.split("/").pop() ?? "";

    if (method === "POST" && p === "/v1/auth/login") {
      const { username } = JSON.parse(String(init?.body)) as { username: string };
      if (scenario.members?.[username] === undefined) {
        return json({ error: { code: "INVALID_CREDENTIALS" } }, 401);
      }
      return json({ token: `token-${username}`, expiresAt: "2099-01-01T00:00:00.000Z" });
    }
    if (p === "/v1/me") {
      const bearer = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "");
      const member = bearer?.startsWith("token-") ? scenario.members?.[bearer.slice("token-".length)] : undefined;
      return json({
        ...me(member ?? scenario.role, scenario.modules ?? ALL_MODULES),
        principalType: scenario.principalType ?? "HUMAN",
      });
    }
    if (p === "/v1/reference/asset-registration") {
      return json({
        assetClasses: [{ code: "TRUCK", labelFr: "Camion", labelEn: "Truck", templateCode: "TRUCKING" }],
        branches: [{ id: BRANCH_ID, code: "DLA", name: "Douala" }],
      });
    }
    if (p === "/v1/assets") return json({ items: [], nextCursor: null });
    if (p === `/v1/assets/${ASSET_ID}`) {
      const reads = scenario.assetReads ?? [];
      const read = reads.length === 0 ? vehicle : (reads[assetReadCount] ?? reads[reads.length - 1] ?? vehicle);
      assetReadCount += 1;
      return scenario.assetStatus === undefined
        ? json(read)
        : json({ error: { code: "REFERENCE_NOT_FOUND" } }, scenario.assetStatus);
    }
    if (p === `/v1/assets/${ASSET_ID}/attention`) {
      await scenario.attentionHeld;
      if (scenario.attentionStatus !== undefined) {
        return json({ error: { code: "INTERNAL" } }, scenario.attentionStatus);
      }
      return json({ assetId: ASSET_ID, businessDate: "2026-09-25", items: scenario.attention ?? [] });
    }
    if (p === `/v1/assets/${ASSET_ID}/finance`) {
      const period = url.searchParams.get("periodCode");
      return json((scenario.finance ?? ((code) => financeFixture(code ?? "2026-09")))(period));
    }
    if (p === `/v1/assets/${ASSET_ID}/history`) {
      const items = scenario.history ?? [];
      return json({
        items: url.searchParams.has("cursor") ? [] : items,
        nextCursor: url.searchParams.has("cursor") ? null : (scenario.historyNextCursor ?? null),
      });
    }
    if (p === `/v1/assets/${ASSET_ID}/readings`) return json({ items: [], nextCursor: null });
    if (p === `/v1/assets/${ASSET_ID}/custodian-candidates`) {
      return json({ items: [{ membershipId: "00000000-0000-4000-8000-000000000091", displayName: "Boris", role: "ADMIN" }] });
    }
    if (p === `/v1/assets/${ASSET_ID}/documents`) {
      return json({ assetId: ASSET_ID, documents: scenario.documents ?? [] });
    }
    if (p === "/v1/work-orders") return json({ items: scenario.workOrders ?? [], nextCursor: null });
    if (p.startsWith("/v1/work-orders/")) {
      const detail = byId(scenario.workOrderDetails, last);
      return detail === undefined ? json({ error: { code: "REFERENCE_NOT_FOUND" } }, 404) : json(detail);
    }
    if (p === "/v1/issues") return json({ items: scenario.issues ?? [], nextCursor: null });
    if (p.startsWith("/v1/issues/")) {
      const detail = byId(scenario.issueDetails, last);
      return detail === undefined ? json({ error: { code: "REFERENCE_NOT_FOUND" } }, 404) : json(detail);
    }
    if (p === "/v1/finance/entries") return json({ entries: scenario.entries ?? [], nextCursor: null });
    if (p.startsWith("/v1/finance/entries/")) {
      const detail = byId(scenario.entryDetails, last);
      return detail === undefined ? json({ error: { code: "REFERENCE_NOT_FOUND" } }, 404) : json(detail);
    }
    if (p.startsWith("/v1/notes/")) {
      const detail = byId(scenario.notes, last);
      return detail === undefined ? json({ error: { code: "REFERENCE_NOT_FOUND" } }, 404) : json(detail);
    }
    if (p === "/v1/activities") return json({ items: scenario.trips ?? [], nextCursor: null });
    if (p.startsWith("/v1/activities/")) {
      const detail = byId(scenario.tripDetails, last);
      return detail === undefined ? json({ error: { code: "REFERENCE_NOT_FOUND" } }, 404) : json(detail);
    }
    if (p === "/v1/categories") {
      const kind = url.searchParams.get("kind");
      const categories =
        kind === "ISSUE_TYPE"
          ? [
              { code: "BRAKES", labelFr: "Freins", labelEn: "Brakes", defaultSafetyCritical: true },
              { code: "BODYWORK", labelFr: "Carrosserie", labelEn: "Bodywork", defaultSafetyCritical: false },
            ]
          : kind === "EXPENSE_CATEGORY"
            ? [
                { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel", defaultSafetyCritical: false },
                { code: "REPAIRS", labelFr: "Réparations", labelEn: "Repairs", defaultSafetyCritical: false },
              ]
            : kind === "REVENUE_CATEGORY"
              ? [{ code: "FREIGHT", labelFr: "Fret", labelEn: "Freight", defaultSafetyCritical: false }]
              : [];
      return json({ kind, categories });
    }
    if (p.startsWith("/v1/history/")) return json({ items: [], nextCursor: null });
    if (p === "/v1/dashboard") return json({});
    throw new Error(`Unexpected request: ${method} ${p}`);
  });

  await i18n.changeLanguage(scenario.locale ?? "en");
  sessionStore.save({ ...identity, token: "vehicle-test-token", expiresAt: "2099-01-01T00:00:00Z" });
  // Reads that set their own `retry` still retry here, but without the backoff.
  const client = new QueryClient({
    defaultOptions: { queries: scenario.defaultRetries === true ? {} : { retry: false, retryDelay: 0 } },
  });
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createRouter({ routeTree: applicationRouter.routeTree, history });
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  });
  return { ...recorded, recorded, history, router, client };
}

/** The requests that asked for a path, for "was it fetched at all" checks. */
export function requested(recorded: Recorded, pathname: string): Array<URL> {
  return recorded.requests.filter((request) => request.url.pathname === pathname).map((request) => request.url);
}

export async function closeVehicle(client?: QueryClient) {
  client?.clear();
  sessionStore.logout(identity);
  vi.unstubAllGlobals();
  localStorage.clear();
  await i18n.changeLanguage("fr-CM");
}
