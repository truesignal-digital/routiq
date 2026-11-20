import { describe, expect, it } from "vitest";
import { createCommandClient } from "@/commands/client.js";
import { CommandStatusStore } from "@/commands/store.js";
import { normalizeLabel, parseImportFile, validateRows, type ImportContext, type ImportField, type RowVerdict } from "./model.js";
import { sendImport } from "./send.js";

const WORKSPACE = "6f1c4a3e-0000-4000-8000-000000000001";

const LABELS = new Map<string, ImportField>([
  [normalizeLabel("Asset code"), "assetCode"],
  [normalizeLabel("Asset class"), "assetClass"],
  [normalizeLabel("Branch"), "branch"],
  [normalizeLabel("Acquisition amount (FCFA)"), "acquisitionAmount"],
]);

const CONTEXT: ImportContext = {
  assetClasses: [{ code: "TRUCK", labelFr: "Camion", labelEn: "Truck" }],
  branches: [{ code: "DLA", name: "Douala" }],
  enabledPresets: ["TRUCKING"],
  templateLabels: { TRUCKING: [], PASSENGER_TRANSPORT: [] },
  unitLabels: { KG: [], TONNE: [], M3: [], SEAT: [] },
  existing: { assetCodes: new Set(), plates: new Set() },
};

const FILE =
  "Asset code,Asset class,Branch,Acquisition amount (FCFA)\n" +
  "VH1,TRUCK,DLA,\nVH2,Truck,DLA,90000000\nVH3,TRUCK,Douala,\nVH4,TRUCK,DLA,\n";

function readyRows(text: string) {
  const parsed = parseImportFile(text, LABELS);
  if (!parsed.ok) throw new Error(parsed.error.code);
  return validateRows(parsed.rows, CONTEXT).filter(
    (verdict): verdict is Extract<RowVerdict, { status: "ready" }> => verdict.status === "ready",
  );
}

interface Posted {
  url: string;
  body: { version: number; envelope: { commandId: string; idempotencyKey: string; origin: string }; payload: { assetId: string; assetCode: string; acquisitionAmountMinor?: number } };
}

/**
 * Stands in for the dispatcher's idempotency (§5.3): only success consumes a
 * key, an exact retry replays the stored answer, and a purchase over the
 * threshold is refused with APPROVAL_REQUIRED like the form sees it.
 */
function fakeServer(options: { failCode?: Record<string, string> } = {}) {
  const posted: Posted[] = [];
  const receipts = new Map<string, unknown>();
  const assets = new Map<string, string>();
  const fetchImpl: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as Posted["body"];
    posted.push({ url: String(input), body });
    const reply = (status: number, json: unknown) => new Response(JSON.stringify(json), { status });
    const stored = receipts.get(body.envelope.idempotencyKey);
    if (stored !== undefined) return reply(200, { ...(stored as object), idempotentReplay: true });
    const failCode = options.failCode?.[body.payload.assetCode];
    if (failCode !== undefined) return reply(409, { error: { code: failCode } });
    if ((body.payload.acquisitionAmountMinor ?? 0) > 50_000_000) {
      return reply(403, { error: { code: "APPROVAL_REQUIRED", metadata: { commandType: "register-asset" } } });
    }
    assets.set(body.payload.assetId, body.payload.assetCode);
    const outcome = { commandId: body.envelope.commandId, recordId: body.payload.assetId, rowVersion: 1, warnings: [], idempotentReplay: false };
    receipts.set(body.envelope.idempotencyKey, outcome);
    return reply(200, outcome);
  };
  const client = createCommandClient({ store: new CommandStatusStore(), getToken: () => "token", fetchImpl });
  return { client, posted, assets };
}

describe("sendImport", () => {
  it("sends one register-asset per ready row, origin CSV_IMPORT, on the named route", async () => {
    const server = fakeServer();
    const rows = readyRows(FILE);
    expect(rows).toHaveLength(4);

    await sendImport(server.client, WORKSPACE, rows);

    expect(server.posted).toHaveLength(4);
    for (const { url, body } of server.posted) {
      expect(url).toBe("/v1/commands/register-asset");
      expect(body.version).toBe(2);
      expect(body.envelope.origin).toBe("CSV_IMPORT");
    }
    expect(server.posted.map((p) => p.body.payload.assetCode)).toEqual(["VH1", "VH2", "VH3", "VH4"]);
  });

  it("reports created, awaiting approval and failed rows, and keeps the ones that succeeded", async () => {
    const server = fakeServer({ failCode: { VH3: "DUPLICATE_ASSET_CODE" } });
    const results = await sendImport(server.client, WORKSPACE, readyRows(FILE));
    expect(results.map((r) => [r.line, r.status, r.status === "failed" ? r.code : undefined])).toEqual([
      [2, "created", undefined],
      [3, "approval", undefined],
      [4, "failed", "DUPLICATE_ASSET_CODE"],
      [5, "created", undefined],
    ]);
    expect([...server.assets.values()]).toEqual(["VH1", "VH4"]);
  });

  it("importing the same file twice creates nothing twice", async () => {
    const server = fakeServer();
    const first = await sendImport(server.client, WORKSPACE, readyRows(FILE));
    const second = await sendImport(server.client, WORKSPACE, readyRows(FILE));

    expect(server.assets.size).toBe(3);
    const envelopes = server.posted.map((p) => [p.body.envelope.commandId, p.body.envelope.idempotencyKey, p.body.payload.assetId]);
    expect(envelopes.slice(4)).toEqual(envelopes.slice(0, 4));
    expect(second.filter((r) => r.status === "created").every((r) => r.status === "created" && r.replay)).toBe(true);
    expect(second.map((r) => r.status)).toEqual(first.map((r) => r.status));
  });

  it("a fixed file keeps the keys of the rows it did not change", async () => {
    const server = fakeServer();
    await sendImport(server.client, WORKSPACE, readyRows(FILE));
    await sendImport(server.client, WORKSPACE, readyRows(FILE.replace("90000000", "40000000")));
    expect(server.assets.size).toBe(4);
    const keys = server.posted.map((p) => p.body.envelope.idempotencyKey);
    expect(keys[4]).toBe(keys[0]);
    expect(keys[5]).not.toBe(keys[1]);
  });

  it("derives different ids in another workspace", async () => {
    const one = fakeServer();
    const other = fakeServer();
    await sendImport(one.client, WORKSPACE, readyRows(FILE));
    await sendImport(other.client, "6f1c4a3e-0000-4000-8000-000000000002", readyRows(FILE));
    expect(other.posted[0]?.body.envelope.commandId).not.toBe(one.posted[0]?.body.envelope.commandId);
    expect(other.posted[0]?.body.payload.assetId).not.toBe(one.posted[0]?.body.payload.assetId);
  });
});
