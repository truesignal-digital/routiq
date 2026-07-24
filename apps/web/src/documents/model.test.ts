import { describe, expect, it } from "vitest";
import { expiryState, groupDocuments, renewalDefaults, type AssetDocument } from "./model.js";

const today = new Date(2026, 6, 23);

describe("expiryState", () => {
  it("past date → expired", () => {
    expect(expiryState("2026-07-22", today)).toBe("expired");
  });
  it("within 30 days → expiringSoon (boundary inclusive)", () => {
    expect(expiryState("2026-07-23", today)).toBe("expiringSoon");
    expect(expiryState("2026-08-22", today)).toBe("expiringSoon");
  });
  it("beyond 30 days → ok; null → none", () => {
    expect(expiryState("2026-08-23", today)).toBe("ok");
    expect(expiryState(null, today)).toBe("none");
  });
});

describe("groupDocuments", () => {
  const doc = (id: string, over: Partial<AssetDocument> = {}): AssetDocument => ({
    id,
    type: { code: "INSURANCE", labelFr: "Assurance", labelEn: "Insurance" },
    title: null,
    documentNumber: null,
    issuedAt: null,
    expiresAt: null,
    supersedesDocumentId: null,
    supersededByDocumentId: null,
    createdAt: "2026-07-23T00:00:00Z",
    ...over,
  });

  it("splits current vs superseded within a type", () => {
    const old = doc("d1", { supersededByDocumentId: "d2" });
    const renewal = doc("d2", { supersedesDocumentId: "d1" });
    const groups = groupDocuments([old, renewal]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.current.map((d) => d.id)).toEqual(["d2"]);
    expect(groups[0]?.superseded.map((d) => d.id)).toEqual(["d1"]);
  });
});

describe("renewalDefaults", () => {
  it("pre-fills all editable fields from the superseded document", () => {
    expect(renewalDefaults({
      id: "d1",
      type: { code: "INSURANCE", labelFr: "Assurance", labelEn: "Insurance" },
      title: "Fleet cover",
      documentNumber: "POL-42",
      issuedAt: "2026-01-01",
      expiresAt: "2027-01-01",
      supersedesDocumentId: null,
      supersededByDocumentId: null,
      createdAt: "2026-01-01T00:00:00Z",
    })).toEqual({
      typeCode: "INSURANCE",
      title: "Fleet cover",
      documentNumber: "POL-42",
      issuedAt: "2026-01-01",
      expiresAt: "2027-01-01",
    });
  });
});
