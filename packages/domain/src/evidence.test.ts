import { describe, expect, it } from "vitest";
import {
  entryEvidenceState,
  type EntryEvidenceFacts,
  type EntryEvidenceState,
  type EntryPaymentMethod,
} from "./evidence.js";

const METHODS: EntryPaymentMethod[] = ["CASH", "MOMO", "OM", "BANK", "OTHER"];

describe("entryEvidenceState", () => {
  it("lets a supplied file win over every other fact", () => {
    for (const policy of ["RECEIPT_EXPECTED", "NO_RECEIPT_EXPECTED"] as const) {
      for (const paymentMethod of METHODS) {
        for (const paymentReference of [null, "TX-1"]) {
          for (const artifactCount of [1, 3]) {
            expect(
              entryEvidenceState({ policy, artifactCount, paymentMethod, paymentReference }),
            ).toBe("SUPPLIED");
          }
        }
      }
    }
  });

  it("reads the full truth table without a file", () => {
    const cases: Array<[Omit<EntryEvidenceFacts, "artifactCount">, EntryEvidenceState]> = [
      [{ policy: "NO_RECEIPT_EXPECTED", paymentMethod: "CASH", paymentReference: null }, "NOT_EXPECTED"],
      [{ policy: "NO_RECEIPT_EXPECTED", paymentMethod: "MOMO", paymentReference: "TX-1" }, "NOT_EXPECTED"],
      [{ policy: "RECEIPT_EXPECTED", paymentMethod: "MOMO", paymentReference: "TX-1" }, "PAYMENT_REFERENCE"],
      [{ policy: "RECEIPT_EXPECTED", paymentMethod: "OM", paymentReference: "TX-2" }, "PAYMENT_REFERENCE"],
      [{ policy: "RECEIPT_EXPECTED", paymentMethod: "BANK", paymentReference: "VIR-3" }, "PAYMENT_REFERENCE"],
      // A reference on cash or "other" is a note, not a verifiable payment.
      [{ policy: "RECEIPT_EXPECTED", paymentMethod: "CASH", paymentReference: "REÇU-4" }, "NOT_SUPPLIED"],
      [{ policy: "RECEIPT_EXPECTED", paymentMethod: "OTHER", paymentReference: "X" }, "NOT_SUPPLIED"],
      [{ policy: "RECEIPT_EXPECTED", paymentMethod: "MOMO", paymentReference: null }, "NOT_SUPPLIED"],
      [{ policy: "RECEIPT_EXPECTED", paymentMethod: "BANK", paymentReference: undefined }, "NOT_SUPPLIED"],
      [{ policy: "RECEIPT_EXPECTED", paymentMethod: "CASH", paymentReference: null }, "NOT_SUPPLIED"],
    ];
    for (const [facts, expected] of cases) {
      expect(entryEvidenceState({ ...facts, artifactCount: 0 }), JSON.stringify(facts)).toBe(expected);
    }
  });
});
