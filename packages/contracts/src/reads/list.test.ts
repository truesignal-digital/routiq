import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  LIST_LIMIT_DEFAULT,
  LIST_LIMIT_MAX,
  listQuery,
  listResponse,
} from "./list.js";

const filters = {
  status: z.enum(["ACTIVE", "SOLD"]).optional(),
  branchId: z.uuid().optional(),
};

const assetsQuery = listQuery(filters, {
  sortFields: ["assetCode", "createdAt"],
});

const branchId = "3f6b2a7c-9d41-4a52-8b0e-2c1d5e6f7a8b";

describe("listQuery", () => {
  it("defaults the limit and leaves sort and cursor unset", () => {
    expect(assetsQuery.parse({})).toEqual({ limit: LIST_LIMIT_DEFAULT });
  });

  it("round-trips filters, sort, cursor and a coerced limit", () => {
    expect(
      assetsQuery.parse({
        status: "ACTIVE",
        branchId,
        sort: "assetCode:desc",
        cursor: "eyJpZCI6IjEifQ",
        limit: "25",
      }),
    ).toEqual({
      status: "ACTIVE",
      branchId,
      sort: { field: "assetCode", direction: "desc" },
      cursor: "eyJpZCI6IjEifQ",
      limit: 25,
    });
  });

  it("defaults a bare sort field to ascending", () => {
    expect(assetsQuery.parse({ sort: "createdAt" }).sort).toEqual({
      field: "createdAt",
      direction: "asc",
    });
  });

  it("still rejects an invalid filter value", () => {
    expect(assetsQuery.safeParse({ status: "INVALID" }).success).toBe(false);
  });

  it.each(["0", "-1", String(LIST_LIMIT_MAX + 1), "10.5", "many"])(
    "rejects out-of-bounds limit %s",
    (limit) => {
      expect(assetsQuery.safeParse({ limit }).success).toBe(false);
    },
  );

  it("accepts the maximum limit", () => {
    expect(assetsQuery.parse({ limit: String(LIST_LIMIT_MAX) }).limit).toBe(
      LIST_LIMIT_MAX,
    );
  });

  it.each([
    "unknownField:asc",
    "assetCode:sideways",
    "assetCode:asc:extra",
    "",
  ])("rejects unsortable sort %s", (sort) => {
    expect(assetsQuery.safeParse({ sort }).success).toBe(false);
  });

  it("rejects any sort when the resource declares no sortable fields", () => {
    const unsortable = listQuery(filters);

    expect(unsortable.safeParse({ sort: "status:asc" }).success).toBe(false);
    expect(unsortable.parse({}).limit).toBe(LIST_LIMIT_DEFAULT);
  });

  it("honours per-resource limit bounds", () => {
    const narrow = listQuery(filters, { defaultLimit: 10, maxLimit: 20 });

    expect(narrow.parse({}).limit).toBe(10);
    expect(narrow.safeParse({ limit: "21" }).success).toBe(false);
  });
});

describe("listResponse", () => {
  const item = z.object({ id: z.uuid() });

  it("wraps items under the default key", () => {
    const schema = listResponse(item);
    const payload = { items: [{ id: branchId }], nextCursor: null };

    expect(schema.parse(payload)).toEqual(payload);
  });

  it("wraps items under an overridden key", () => {
    const schema = listResponse(item, { key: "entries" });
    const payload = { entries: [{ id: branchId }], nextCursor: "opaque" };

    expect(schema.parse(payload)).toEqual(payload);
    expect(schema.safeParse({ items: [], nextCursor: null }).success).toBe(false);
  });

  it("requires nextCursor to be present, string or null", () => {
    const schema = listResponse(item);

    expect(schema.safeParse({ items: [] }).success).toBe(false);
    expect(schema.safeParse({ items: [], nextCursor: 1 }).success).toBe(false);
  });

  it("rejects an item that fails the item schema", () => {
    const schema = listResponse(item);

    expect(
      schema.safeParse({ items: [{ id: "not-a-uuid" }], nextCursor: null })
        .success,
    ).toBe(false);
  });
});
