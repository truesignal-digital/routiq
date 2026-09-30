/**
 * What a financial entry's paperwork says, in four honest states — none of
 * which is "verified": ROUTIQ records that a file was supplied, never that it
 * proves the spend.
 *
 * - SUPPLIED: at least one file is linked to the entry.
 * - NOT_EXPECTED: no file, and the category declares none is expected
 *   (declared cash spend: tolls, parking, allowances).
 * - PAYMENT_REFERENCE: no file, but a Mobile Money, Orange Money or bank
 *   reference stands in for one (§5.4). A receipt is not inferred from it.
 * - NOT_SUPPLIED: none of the above.
 *
 * The order is the precedence: a file wins over everything, and the category's
 * policy over a payment reference. The API mirrors this rule in SQL for list
 * filters (reads/entry-evidence.ts) and a parity test holds the two together;
 * the entry writer's EVIDENCE_MISSING warning is exactly NOT_SUPPLIED.
 */
export const ENTRY_EVIDENCE_STATES = [
  "SUPPLIED",
  "PAYMENT_REFERENCE",
  "NOT_EXPECTED",
  "NOT_SUPPLIED",
] as const;

export type EntryEvidenceState = (typeof ENTRY_EVIDENCE_STATES)[number];

export type EntryEvidencePolicy = "RECEIPT_EXPECTED" | "NO_RECEIPT_EXPECTED";

export type EntryPaymentMethod = "CASH" | "MOMO" | "OM" | "BANK" | "OTHER";

/** The methods whose transaction reference counts as evidence (§5.4). */
export const REFERENCE_PAYMENT_METHODS: readonly EntryPaymentMethod[] = ["MOMO", "OM", "BANK"];

export interface EntryEvidenceFacts {
  policy: EntryEvidencePolicy;
  artifactCount: number;
  paymentMethod: EntryPaymentMethod;
  paymentReference: string | null | undefined;
}

export function entryEvidenceState(facts: EntryEvidenceFacts): EntryEvidenceState {
  if (facts.artifactCount >= 1) return "SUPPLIED";
  if (facts.policy === "NO_RECEIPT_EXPECTED") return "NOT_EXPECTED";
  if (
    REFERENCE_PAYMENT_METHODS.includes(facts.paymentMethod) &&
    facts.paymentReference !== null &&
    facts.paymentReference !== undefined
  ) {
    return "PAYMENT_REFERENCE";
  }
  return "NOT_SUPPLIED";
}
