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

  it("tags a code with its set, and drops one the set does not know", async () => {
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
    ]);
  });

  it("drops an object or a uuid under a plain-value key rather than printing it", async () => {
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
    expect(changes).toEqual([{ field: "cancelReason", kind: "VALUE", before: null, after: "Doublon" }]);
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
