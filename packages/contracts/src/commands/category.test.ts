import { describe, expect, it } from "vitest";
import {
  createCategoryCommand,
  deactivateCategoryCommand,
  reactivateCategoryCommand,
  relabelCategoryCommand,
} from "./category.js";

const envelope = {
  commandId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  idempotencyKey: "category-command",
  origin: "API",
  sourceArtifactIds: [],
};

const validCreateCommand = {
  name: "create-category",
  version: 1,
  envelope,
  payload: {
    id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    kind: "EXPENSE_CATEGORY",
    code: "DRIVER_ALLOWANCE",
    labelFr: "Indemnité chauffeur",
    labelEn: "Driver allowance",
    profitabilityLayer: "DIRECT",
    evidencePolicy: "NO_RECEIPT_EXPECTED",
  },
};

describe("createCategoryCommand", () => {
  it("accepts a valid command", () => {
    expect(createCategoryCommand.parse(validCreateCommand).payload.code).toBe(
      "DRIVER_ALLOWANCE",
    );
  });

  it.each(["driver_allowance", "DRIVER ALLOWANCE"])(
    "rejects invalid category code %s",
    (code) => {
      expect(
        createCategoryCommand.safeParse({
          ...validCreateCommand,
          payload: { ...validCreateCommand.payload, code },
        }).success,
      ).toBe(false);
    },
  );

  it("rejects category codes longer than 40 characters", () => {
    expect(
      createCategoryCommand.safeParse({
        ...validCreateCommand,
        payload: { ...validCreateCommand.payload, code: `A${"B".repeat(40)}` },
      }).success,
    ).toBe(false);
  });

  it("rejects missing or empty labels", () => {
    const { labelFr: _labelFr, ...withoutLabelFr } = validCreateCommand.payload;

    expect(
      createCategoryCommand.safeParse({
        ...validCreateCommand,
        payload: withoutLabelFr,
      }).success,
    ).toBe(false);
    expect(
      createCategoryCommand.safeParse({
        ...validCreateCommand,
        payload: { ...validCreateCommand.payload, labelEn: "" },
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown category kind", () => {
    expect(
      createCategoryCommand.safeParse({
        ...validCreateCommand,
        payload: { ...validCreateCommand.payload, kind: "UNKNOWN_CATEGORY" },
      }).success,
    ).toBe(false);
  });
});

describe("relabelCategoryCommand", () => {
  const valid = {
    name: "relabel-category",
    version: 1,
    envelope,
    payload: {
      categoryId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      labelFr: "Carburant",
      labelEn: "Fuel",
    },
  };

  it("accepts a valid command", () => {
    expect(relabelCategoryCommand.parse(valid).payload.labelEn).toBe("Fuel");
  });

  it("rejects an invalid payload", () => {
    expect(
      relabelCategoryCommand.safeParse({
        ...valid,
        payload: { ...valid.payload, labelFr: "" },
      }).success,
    ).toBe(false);
  });
});

describe("deactivateCategoryCommand", () => {
  const valid = {
    name: "deactivate-category",
    version: 1,
    envelope,
    payload: {
      categoryId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    },
  };

  it("accepts a valid command", () => {
    expect(deactivateCategoryCommand.safeParse(valid).success).toBe(true);
  });

  it("rejects an invalid payload", () => {
    expect(
      deactivateCategoryCommand.safeParse({
        ...valid,
        payload: { categoryId: "not-a-uuid" },
      }).success,
    ).toBe(false);
  });
});

describe("reactivateCategoryCommand", () => {
  const valid = {
    name: "reactivate-category",
    version: 1,
    envelope,
    payload: {
      categoryId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    },
  };

  it("accepts a valid command", () => {
    expect(reactivateCategoryCommand.safeParse(valid).success).toBe(true);
  });

  it("rejects an invalid payload", () => {
    expect(
      reactivateCategoryCommand.safeParse({
        ...valid,
        payload: {},
      }).success,
    ).toBe(false);
  });
});
