import { describe, expect, it } from "vitest";
import type { TenantTx } from "../db/tenant.js";
import { presentChanges } from "./history-present.js";
import { diffStates } from "./history.js";

/** No change below names a record, so nothing may reach the database. */
const noDatabase = new Proxy({}, {
  get() {
    throw new Error("presentChanges queried the database for changes that name nothing");
  },
}) as TenantTx;

const lines = [
  { id: "a", lineNo: 1, amountMinor: 30_000, categoryId: "c" },
  { id: "b", lineNo: 2, amountMinor: 15_000, categoryId: "c" },
];

describe("presentChanges", () => {
  it("summarises posting lines as a count and the total they sum to", async () => {
    const changes = await presentChanges(
      noDatabase,
      "ws",
      "financial_entry",
      diffStates("financial_entry", null, { postings: lines }),
      { showMoney: true },
    );
    expect(changes).toEqual([
      { field: "postings", kind: "LINES", before: null, after: { count: 2, totalMinor: 45_000 } },
    ]);
  });

  it("keeps the count but drops the total, with the money, for a reader who may not see money", async () => {
    const changes = await presentChanges(
      noDatabase,
      "ws",
      "financial_entry",
      diffStates("financial_entry", null, { postings: lines, amountMinor: 45_000 }),
      { showMoney: false },
    );
    expect(changes).toEqual([
      { field: "postings", kind: "LINES", before: null, after: { count: 2, totalMinor: null } },
    ]);
  });

  it("tags a code with its set, and says one the set does not know is not available", async () => {
    const changes = await presentChanges(
      noDatabase,
      "ws",
      "work_order",
      diffStates(
        "work_order",
        { status: "APPROVED", costOutcome: null },
        { status: "COMPLETED", costOutcome: "SOMETHING_NEW" },
      ),
      { showMoney: true },
    );
    expect(changes).toEqual([
      { field: "status", kind: "CODE", codeSet: "workOrderStatus", before: "APPROVED", after: "COMPLETED" },
      { field: "costOutcome", kind: "UNAVAILABLE" },
    ]);
  });

  it("says an object or a uuid under a plain-value key is not available rather than printing it", async () => {
    const changes = await presentChanges(
      noDatabase,
      "ws",
      "work_order",
      diffStates(
        "work_order",
        null,
        { summary: { text: "x" }, description: "3f2a1c4e-1b2c-4d3e-8f90-123456789abc", cancelReason: "Doublon" },
      ),
      { showMoney: true },
    );
    expect(changes).toEqual([
      { field: "description", kind: "UNAVAILABLE" },
      { field: "summary", kind: "UNAVAILABLE" },
      { field: "cancelReason", kind: "VALUE", before: null, after: "Doublon" },
    ]);
    expect(JSON.stringify(changes)).not.toContain("3f2a1c4e");
  });

  it("leaves out money the reader may not see, which is a permission rather than a value it cannot show", async () => {
    const changes = await presentChanges(
      noDatabase,
      "ws",
      "work_order",
      diffStates("work_order", { actualCostMinor: null }, { actualCostMinor: { not: "money" }, summary: "Fait" }),
      { showMoney: false },
    );
    expect(changes).toEqual([{ field: "summary", kind: "VALUE", before: null, after: "Fait" }]);
  });

  it("reads money a writer stored as a bigint's decimal string, as the threshold and work-order writers do", async () => {
    const changes = await presentChanges(
      noDatabase,
      "ws",
      "work_order",
      diffStates("work_order", { declaredCostMinor: "325000" }, { declaredCostMinor: null, expectedCostMinor: "12.5" }),
      { showMoney: true },
    );
    expect(changes).toEqual([
      { field: "expectedCostMinor", kind: "UNAVAILABLE" },
      { field: "declaredCostMinor", kind: "MONEY", before: 325_000, after: null },
    ]);
  });

  it("never shows the vehicle's specification bag, which only the vehicle History tab words", async () => {
    const raw = diffStates("asset", { customValues: { axles: 2 } }, { customValues: { axles: 3 } });
    expect(raw.map((change) => change.field)).toEqual(["customValues"]);
    expect(await presentChanges(noDatabase, "ws", "asset", raw, { showMoney: true })).toEqual([]);
  });

  it("treats an empty list as nothing, so a creation that records no crew shows no change", async () => {
    const raw = diffStates("activity", null, { crew: [], completenessCodes: [], segmentIds: [] });
    expect(raw).toHaveLength(3);
    const changes = await presentChanges(noDatabase, "ws", "activity", raw, { showMoney: true });
    expect(changes).toEqual([]);
  });
});
