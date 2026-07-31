import { describe, expect, it } from "vitest";
import { MODULE_CODES } from "../modules.js";
import {
  HISTORY_ENTITY_MODULE,
  HISTORY_ENTITY_TYPES,
  historyItem,
  historyListQuery,
  historyListResponse,
} from "./history.js";

const item = {
  eventId: "8c9a1f5e-2b74-4d16-93a0-1e7c5d8b4f30",
  eventType: "activity.reopened",
  occurredAt: "2026-07-30T09:15:00.000Z",
  actor: {
    principalId: "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    displayName: "Awa Nkeng",
    scope: "WORKSPACE",
  },
  command: {
    id: "5b6c7d8e-9f01-4a2b-8c3d-4e5f6a7b8c9d",
    name: "reopen-activity",
    version: "1",
    origin: "HUMAN_UI",
    clientOccurredAt: null,
  },
  changedFields: ["status", "completeness"],
  note: "Feuille de route corrigée par le bureau",
};

describe("history item contract", () => {
  it("accepts a tenant-actor event", () => {
    expect(historyItem.parse(item)).toEqual(item);
  });

  it("accepts a PLATFORM event with no principal behind it", () => {
    const platformItem = {
      ...item,
      eventType: "workspace.provisioned",
      actor: { principalId: null, displayName: null, scope: "PLATFORM" },
      changedFields: [],
      note: null,
    };
    expect(historyItem.parse(platformItem)).toEqual(platformItem);
  });

  it("keeps eventType open so a new command's events still render", () => {
    expect(
      historyItem.safeParse({ ...item, eventType: "work-order.opened" }).success,
    ).toBe(true);
  });

  it("rejects an actor scope outside the two the schema masks on", () => {
    expect(
      historyItem.safeParse({
        ...item,
        actor: { ...item.actor, scope: "BRANCH" },
      }).success,
    ).toBe(false);
  });

  it("wraps rows under `items` per ADR-0003", () => {
    expect(historyListResponse.parse({ items: [item], nextCursor: null })).toEqual(
      { items: [item], nextCursor: null },
    );
  });
});

describe("history query contract", () => {
  it("defaults the page size and leaves the cursor unset", () => {
    expect(historyListQuery.parse({})).toEqual({ limit: 50 });
  });

  it("refuses a client-chosen sort — the timeline order is fixed", () => {
    expect(historyListQuery.safeParse({ sort: "occurredAt:asc" }).success).toBe(
      false,
    );
  });

  it("bounds the page size", () => {
    expect(historyListQuery.safeParse({ limit: "500" }).success).toBe(false);
  });
});

describe("entity type to module map", () => {
  it("covers every known entity type with a registered module", () => {
    for (const entityType of HISTORY_ENTITY_TYPES) {
      expect(MODULE_CODES).toContain(HISTORY_ENTITY_MODULE[entityType]);
    }
  });
});
