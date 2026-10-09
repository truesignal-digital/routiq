import { describe, expect, it } from "vitest";
import {
  CANCELLATION_REASON_CODES,
  reverseEntryCommand,
  reverseEntryV1Command,
  reverseEntryV1ToV2,
} from "./reverse-entry.js";

const envelope = {
  commandId: "0d1f7a3c-0b6e-4a5f-9d2c-7e8b1a2c3d4e",
  idempotencyKey: "8d7c6b5a-4f3e-42d1-9c8b-7a6f5e4d3c2b",
  origin: "HUMAN_UI",
  sourceArtifactIds: [],
} as const;

const ids = {
  reversalEntryId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  originalEntryId: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
} as const;

const valid = {
  name: "reverse-entry",
  version: 2,
  envelope,
  payload: { ...ids, reasonCode: "ENTERED_TWICE" },
} as const;

const withPayload = (payload: Record<string, unknown>) => ({ ...valid, payload });

describe("reverse-entry v2 contract (Cancel entry)", () => {
  it("offers the four reasons of the short list, in order", () => {
    expect(CANCELLATION_REASON_CODES).toEqual([
      "ENTERED_TWICE",
      "DID_NOT_HAPPEN",
      "WRONG_DETAILS",
      "OTHER",
    ]);
  });

  it.each(["ENTERED_TWICE", "DID_NOT_HAPPEN", "WRONG_DETAILS"])(
    "accepts %s without text",
    (reasonCode) => {
      expect(reverseEntryCommand.safeParse(withPayload({ ...ids, reasonCode })).success).toBe(true);
    },
  );

  it("refuses OTHER without text", () => {
    expect(reverseEntryCommand.safeParse(withPayload({ ...ids, reasonCode: "OTHER" })).success).toBe(false);
  });

  it("refuses OTHER with blank text", () => {
    expect(
      reverseEntryCommand.safeParse(withPayload({ ...ids, reasonCode: "OTHER", reasonText: "   " })).success,
    ).toBe(false);
  });

  it("accepts OTHER with text and keeps it trimmed", () => {
    const parsed = reverseEntryCommand.parse(
      withPayload({ ...ids, reasonCode: "OTHER", reasonText: "  Fuel card refunded  " }),
    );
    expect(parsed.payload.reasonText).toBe("Fuel card refunded");
  });

  it("refuses a code outside the list", () => {
    expect(reverseEntryCommand.safeParse(withPayload({ ...ids, reasonCode: "TYPO" })).success).toBe(false);
  });

  it("refuses text longer than 500 characters", () => {
    expect(
      reverseEntryCommand.safeParse(withPayload({ ...ids, reasonCode: "OTHER", reasonText: "x".repeat(501) }))
        .success,
    ).toBe(false);
  });

  it("refuses the v1 free-text field under v2", () => {
    expect(reverseEntryCommand.safeParse(withPayload({ ...ids, reason: "Duplicate entry." })).success).toBe(false);
  });

  it("rejects invalid UUIDs", () => {
    expect(
      reverseEntryCommand.safeParse(withPayload({ ...valid.payload, reversalEntryId: "not-a-uuid" })).success,
    ).toBe(false);
    expect(
      reverseEntryCommand.safeParse(withPayload({ ...valid.payload, originalEntryId: "not-a-uuid" })).success,
    ).toBe(false);
  });
});

describe("reverse-entry v1 contract (frozen, kept for replay)", () => {
  const v1 = {
    name: "reverse-entry",
    version: 1,
    envelope,
    payload: { ...ids, reason: "Duplicate entry." },
  } as const;

  it("still accepts the free-text reason", () => {
    expect(reverseEntryV1Command.parse(v1).payload.reason).toBe("Duplicate entry.");
  });

  it("still rejects an empty or missing reason", () => {
    expect(reverseEntryV1Command.safeParse({ ...v1, payload: { ...ids, reason: "" } }).success).toBe(false);
    expect(reverseEntryV1Command.safeParse({ ...v1, payload: ids }).success).toBe(false);
  });

  it("maps to OTHER with its text", () => {
    expect(reverseEntryV1ToV2(v1.payload)).toEqual({
      ...ids,
      reasonCode: "OTHER",
      reasonText: "Duplicate entry.",
    });
  });
});
