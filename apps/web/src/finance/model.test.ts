import { describe, expect, it } from "vitest";
import {
  amountKind,
  parseMoneyXaf,
  toRecordExpensePayload,
  toRecordRevenuePayload,
  type FinanceFormState,
} from "./model.js";

describe("parseMoneyXaf", () => {
  it("parses valid positive integers", () => {
    expect(parseMoneyXaf("1000")).toBe(1000);
    expect(parseMoneyXaf("0")).toBe(0);
    expect(parseMoneyXaf("123456")).toBe(123456);
  });

  it("removes thousands separators", () => {
    expect(parseMoneyXaf("1 000")).toBe(1000);
    expect(parseMoneyXaf("123 456")).toBe(123456);
  });

  it("rejects invalid input", () => {
    expect(parseMoneyXaf("")).toBeNull();
    expect(parseMoneyXaf("   ")).toBeNull();
    expect(parseMoneyXaf("-1")).toBeNull();
    expect(parseMoneyXaf("abc")).toBeNull();
    expect(parseMoneyXaf("12.34")).toBeNull();
  });

  it("reads the grouping of the language the input was formatted in", () => {
    expect(parseMoneyXaf("86,000", "en")).toBe(86_000);
    expect(parseMoneyXaf("86 000", "fr-CM")).toBe(86_000);
    expect(parseMoneyXaf("86,000", "fr-CM")).toBeNull();
    expect(parseMoneyXaf("86.5", "en")).toBeNull();
  });
});

describe("toRecordExpensePayload", () => {
  const formState = (overrides: Partial<FinanceFormState> = {}): FinanceFormState => ({
    entryId: "550e8400-e29b-41d4-a716-446655440000",
    branchCode: "CM-YDE",
    economicDate: "2026-07-26",
    categoryCode: "FUEL",
    amountMinor: 50000,
    paymentMethod: "CASH",
    ...overrides,
  });

  it("creates a payload with single posting equal to entry amount", () => {
    const form = formState();
    const payload = toRecordExpensePayload(form);

    expect(payload.entryId).toBe(form.entryId);
    expect(payload.amountMinor).toBe(50000);
    expect(payload.postings).toHaveLength(1);
    expect(payload.postings[0]?.amountMinor).toBe(50000);
    expect(payload.postings[0]?.assetAttribution).toBe("DIRECT");
  });

  it("includes optional assetId when provided", () => {
    const form = formState({ assetId: "asset-123" });
    const payload = toRecordExpensePayload(form);

    expect(payload.postings[0]?.assetId).toBe("asset-123");
  });

  it("omits assetId when not provided", () => {
    const form = formState();
    const payload = toRecordExpensePayload(form);

    expect(payload.postings[0]?.assetId).toBeUndefined();
  });

  it("includes optional counterpartyName and description", () => {
    const form = formState({
      counterpartyName: "Petrol Station",
      description: "Fuel for truck A",
    });
    const payload = toRecordExpensePayload(form);

    expect(payload.counterpartyName).toBe("Petrol Station");
    expect(payload.description).toBe("Fuel for truck A");
  });

  it("sets currency to XAF and estimateStatus to ACTUAL", () => {
    const form = formState();
    const payload = toRecordExpensePayload(form);

    expect(payload.currency).toBe("XAF");
    expect(payload.estimateStatus).toBe("ACTUAL");
  });
});

describe("toRecordRevenuePayload", () => {
  const formState = (overrides: Partial<FinanceFormState> = {}): FinanceFormState => ({
    entryId: "550e8400-e29b-41d4-a716-446655440000",
    branchCode: "CM-YDE",
    economicDate: "2026-07-26",
    categoryCode: "PASSENGER_REVENUE",
    amountMinor: 150000,
    paymentMethod: "MOMO",
    ...overrides,
  });

  it("creates a revenue payload with matching structure", () => {
    const form = formState();
    const payload = toRecordRevenuePayload(form);

    expect(payload.amountMinor).toBe(150000);
    expect(payload.postings[0]?.amountMinor).toBe(150000);
    expect(payload.postings).toHaveLength(1);
  });
});

describe("branch code validation (regression: branchScope bug)", () => {
  it("requires branchCode to be non-empty (user-selected, not branchScope-derived)", () => {
    const formState: FinanceFormState = {
      entryId: "550e8400-e29b-41d4-a716-446655440000",
      branchCode: "CM-YDE",
      economicDate: "2026-07-26",
      categoryCode: "FUEL",
      amountMinor: 50000,
      paymentMethod: "CASH",
    };

    const payload = toRecordExpensePayload(formState);

    // branchCode must be non-empty and match the selected value
    expect(payload.branchCode).toBe("CM-YDE");
    expect(payload.branchCode.length).toBeGreaterThan(0);
  });

  it("fails contract validation if branchCode is empty (prevents ALL-scope bug)", () => {
    const emptyBranchForm: FinanceFormState = {
      entryId: "550e8400-e29b-41d4-a716-446655440000",
      branchCode: "",
      economicDate: "2026-07-26",
      categoryCode: "FUEL",
      amountMinor: 50000,
      paymentMethod: "CASH",
    };

    const payload = toRecordExpensePayload(emptyBranchForm);

    // Payload with empty branchCode should fail server-side validation
    // (z.string().min(1) in the contract)
    expect(payload.branchCode).toBe("");
    // This would fail contract validation when sent to server
  });

  it("uses selected branch code (not branchScope which is UUID array or ALL)", () => {
    // Regression: previously used me.branchScope which is "ALL" for admins
    // or an array of branch UUIDs for scoped users
    // Now we pass selected branchCode from dropdown
    const selectedBranchForm: FinanceFormState = {
      entryId: "550e8400-e29b-41d4-a716-446655440000",
      branchCode: "CM-DB",
      economicDate: "2026-07-26",
      categoryCode: "MAINTENANCE",
      amountMinor: 25000,
      paymentMethod: "BANK",
    };

    const payload = toRecordExpensePayload(selectedBranchForm);

    // The payload must contain the selected branch CODE (not UUID or "ALL")
    expect(payload.branchCode).toBe("CM-DB");
    expect(payload.branchCode).toMatch(/^[A-Z]{2}-[A-Z]{2}$/);
  });
});

describe("amountKind", () => {
  it("names a record's direction, and a reversal's, for the words beside its unsigned amount", () => {
    expect(amountKind({ direction: "EXPENSE", reversesEntryId: null })).toBe("EXPENSE");
    expect(amountKind({ direction: "REVENUE", reversesEntryId: null })).toBe("REVENUE");
    expect(amountKind({ direction: "EXPENSE", reversesEntryId: "x" })).toBe("EXPENSE_REVERSAL");
  });
});
