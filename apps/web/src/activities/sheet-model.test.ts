import {
  recordHaulageJobSheetPayload,
  recordJourneySheetPayload,
  type CommandResult,
} from "@routiq/contracts";
import { describe, expect, it } from "vitest";
import {
  pendingChildrenCount,
  toHaulageSheetPayload,
  toJourneySheetPayload,
  toLocalOffsetIso,
  type SheetFormState,
  type SheetIds,
} from "./sheet-model.js";

const ids: SheetIds = {
  activityId: "11111111-1111-4111-8111-111111111111",
  primarySegmentId: "22222222-2222-4222-8222-222222222222",
  startReadingId: "33333333-3333-4333-8333-333333333333",
  endReadingId: "44444444-4444-4444-8444-444444444444",
};

const ASSET = "55555555-5555-4555-8555-555555555555";
const TRAILER = "66666666-6666-4666-8666-666666666666";
const PERSON = "77777777-7777-4777-8777-777777777777";
/** Douala is UTC+1, which getTimezoneOffset reports as -60. */
const DOUALA = -60;

function minimalState(overrides: Partial<SheetFormState> = {}): SheetFormState {
  return {
    template: "journey",
    branchCode: "DLA",
    activityTypeCode: "SCHEDULED_JOURNEY",
    primaryAssetId: ASSET,
    startedAt: "2026-07-28T06:00",
    endedAt: "2026-07-28T14:30",
    extraSegments: [],
    crew: [],
    legs: [],
    entries: [],
    ...overrides,
  };
}

describe("toLocalOffsetIso", () => {
  it("appends the ISO offset, inverting the getTimezoneOffset sign", () => {
    expect(toLocalOffsetIso("2026-07-28T06:00", DOUALA)).toBe(
      "2026-07-28T06:00:00+01:00",
    );
  });

  it("west of UTC keeps a negative suffix", () => {
    // New York in summer: getTimezoneOffset() === 240.
    expect(toLocalOffsetIso("2026-07-28T06:00", 240)).toBe(
      "2026-07-28T06:00:00-04:00",
    );
  });

  it("UTC renders +00:00, never -00:00", () => {
    expect(toLocalOffsetIso("2026-07-28T06:00", 0)).toBe(
      "2026-07-28T06:00:00+00:00",
    );
  });

  it("handles half-hour zones and preserves supplied seconds", () => {
    expect(toLocalOffsetIso("2026-07-28T06:00:45", -330)).toBe(
      "2026-07-28T06:00:45+05:30",
    );
  });

  it("leaves an unparseable value alone so the schema reports it", () => {
    expect(toLocalOffsetIso("", DOUALA)).toBe("");
    expect(toLocalOffsetIso("2026-07-28", DOUALA)).toBe("2026-07-28");
  });

  it("defaults to the runtime zone when no offset is given", () => {
    const at = "2026-07-28T06:00";
    const expected = -new Date(at).getTimezoneOffset();
    const suffix = toLocalOffsetIso(at).slice(-6);
    const sign = expected < 0 ? "-" : "+";
    expect(suffix.startsWith(sign)).toBe(true);
  });
});

describe("toJourneySheetPayload", () => {
  it("a minimal sheet parses against the contract", () => {
    const payload = toJourneySheetPayload(minimalState(), ids, DOUALA);
    const parsed = recordJourneySheetPayload.safeParse(payload);
    expect(parsed.success).toBe(true);
    expect(payload.startedAt).toBe("2026-07-28T06:00:00+01:00");
    expect(payload.endedAt).toBe("2026-07-28T14:30:00+01:00");
    expect(payload.crew).toEqual([]);
    expect(payload.customValues).toEqual({});
  });

  it("omits blank optionals rather than sending empty strings", () => {
    const payload = toJourneySheetPayload(
      minimalState({ customerName: "  ", clientReference: "", seatsSold: "" }),
      ids,
      DOUALA,
    );
    expect("customerName" in payload).toBe(false);
    expect("clientReference" in payload).toBe(false);
    expect("seatsSold" in payload).toBe(false);
    expect("startReading" in payload).toBe(false);
  });

  it("a blank meter reading is absent, not a reading of zero", () => {
    const payload = toJourneySheetPayload(
      minimalState({
        startReading: { value: "", readingType: "ODOMETER" },
        endReading: { value: "142 300", readingType: "ODOMETER" },
      }),
      ids,
      DOUALA,
    );
    expect(payload.startReading).toBeUndefined();
    expect(payload.endReading).toEqual({
      readingId: ids.endReadingId,
      readingType: "ODOMETER",
      value: 142300,
      observedAt: "2026-07-28T14:30:00+01:00",
    });
    expect(recordJourneySheetPayload.safeParse(payload).success).toBe(true);
  });

  it("renumbers legs from their position so a deleted row leaves no gap", () => {
    const leg = (legId: string, from: string, to: string) => ({
      legId,
      legNo: 99,
      origin: { kind: "text" as const, text: from },
      destination: { kind: "text" as const, text: to },
    });
    const payload = toJourneySheetPayload(
      minimalState({
        legs: [
          leg("88888888-8888-4888-8888-888888888888", "Douala", "Edéa"),
          leg("99999999-9999-4999-8999-999999999999", "Edéa", "Yaoundé"),
        ],
      }),
      ids,
      DOUALA,
    );
    expect(payload.legs.map((l) => l.legNo)).toEqual([1, 2]);
    expect(recordJourneySheetPayload.safeParse(payload).success).toBe(true);
  });

  it("entries default to being attributed to the activity", () => {
    const payload = toJourneySheetPayload(
      minimalState({
        entries: [
          {
            entryId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            direction: "EXPENSE",
            categoryCode: "FUEL",
            amount: "45 000",
            paymentMethod: "CASH",
            attributeToActivity: true,
          },
          {
            entryId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            direction: "EXPENSE",
            categoryCode: "REPAIR",
            amount: "12000",
            paymentMethod: "MOMO",
            assetId: ASSET,
            attributeToActivity: false,
          },
        ],
      }),
      ids,
      DOUALA,
    );

    expect(payload.entries[0]?.attributeToActivity).toBe(true);
    expect(payload.entries[1]?.attributeToActivity).toBe(false);
    // XAF has exponent 0 — 45 000 XAF is 45000 minor units.
    expect(payload.entries[0]?.amountMinor).toBe(45000);
    // Every line takes the trip's own start date as its economic date.
    expect(payload.entries[0]?.economicDate).toBe("2026-07-28");
    expect(recordJourneySheetPayload.safeParse(payload).success).toBe(true);
  });
});

describe("toHaulageSheetPayload", () => {
  it("a full sheet parses against the contract", () => {
    const state = minimalState({
      template: "haulage",
      activityTypeCode: "HAULAGE_JOB",
      customerName: "SOCACAO",
      clientReference: "BL-2291",
      description: "Cacao Douala → Yaoundé",
      cargoDescription: "Cacao en sacs",
      cargoWeightKg: "24 000",
      startReading: { value: "141950", readingType: "ODOMETER" },
      endReading: { value: "142300", readingType: "ODOMETER" },
      extraSegments: [
        {
          segmentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          assetId: TRAILER,
          role: "TRAILER",
        },
      ],
      crew: [
        {
          activityPersonId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          personId: PERSON,
          role: "DRIVER",
        },
      ],
      legs: [
        {
          legId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          legNo: 1,
          origin: {
            kind: "place",
            placeId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
            name: "Douala",
          },
          destination: { kind: "text", text: "Carrière PK14" },
          departedAt: "2026-07-28T06:15",
          arrivedAt: "2026-07-28T13:45",
          distanceKm: "246",
          loadState: "LADEN",
        },
      ],
      entries: [
        {
          entryId: "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa",
          direction: "REVENUE",
          categoryCode: "FREIGHT",
          amount: "850 000",
          paymentMethod: "BANK",
          counterpartyName: "SOCACAO",
          reference: "VIR-77",
          description: "Transport cacao",
          attributeToActivity: true,
        },
        {
          entryId: "aaaaaaaa-2222-4aaa-8aaa-aaaaaaaaaaaa",
          direction: "EXPENSE",
          categoryCode: "CREW_PAY",
          amount: "40000",
          paymentMethod: "CASH",
          personId: PERSON,
          attributeToActivity: true,
        },
      ],
    });

    const payload = toHaulageSheetPayload(state, ids, DOUALA);
    const parsed = recordHaulageJobSheetPayload.safeParse(payload);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);

    expect(payload.cargoWeightKg).toBe(24000);
    expect(payload.legs[0]?.departedAt).toBe("2026-07-28T06:15:00+01:00");
    expect(payload.legs[0]?.distanceKm).toBe(246);
    // A trailer with no times of its own inherits the activity's start.
    expect(payload.extraSegments[0]?.startedAt).toBe("2026-07-28T06:00:00+01:00");
    expect(payload.entries[0]?.paymentReference).toBe("VIR-77");
    expect(payload.entries[1]?.personId).toBe(PERSON);
  });
});

describe("pendingChildrenCount", () => {
  const base: CommandResult = {
    commandId: "c1",
    recordId: "r1",
    rowVersion: 1,
    warnings: [],
    idempotentReplay: false,
  };

  it("is zero when the command created no children", () => {
    expect(pendingChildrenCount(base)).toBe(0);
  });

  it("counts only the lines still waiting for an approver", () => {
    expect(
      pendingChildrenCount({
        ...base,
        children: [
          { entityType: "financial_entry", id: "e1", status: "POSTED", warnings: [] },
          { entityType: "financial_entry", id: "e2", status: "SUBMITTED", warnings: [] },
          { entityType: "financial_entry", id: "e3", status: "SUBMITTED", warnings: [] },
        ],
      }),
    ).toBe(2);
  });
});
