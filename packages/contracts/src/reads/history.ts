import { z } from "zod";
import { COMMAND_ORIGINS } from "../envelope.js";
import type { ModuleCode } from "../modules.js";
import { listQuery, listResponse } from "./list.js";

/**
 * Entity types the audit trail addresses. Closed on purpose — unlike
 * `eventType`, this is our own row vocabulary, and a URL segment has to resolve
 * to an owning module before the read can decide who may see the timeline.
 */
export const HISTORY_ENTITY_TYPES = [
  "activity",
  "activity_asset_segment",
  "approval_rule",
  "asset",
  "category",
  "document",
  "financial_entry",
  "meter_reading",
  "movement_leg",
  "person",
  "posting_period",
  "workspace",
  "workspace_module",
  "workspace_template",
] as const;

export const historyEntityType = z.enum(HISTORY_ENTITY_TYPES);

export type HistoryEntityType = (typeof HISTORY_ENTITY_TYPES)[number];

/**
 * History is visible to whoever can read the record, so the owning module's
 * entitlement (plus RLS) is the whole gate. Ownership mirrors the `module`
 * field on the commands that write each entity type — `person` sits under
 * ACTIVITIES because `register-person` does.
 */
export const HISTORY_ENTITY_MODULE = {
  activity: "ACTIVITIES",
  activity_asset_segment: "ACTIVITIES",
  approval_rule: "CORE",
  asset: "ASSETS",
  category: "CORE",
  document: "DOCUMENTS",
  financial_entry: "FINANCE",
  meter_reading: "ACTIVITIES",
  movement_leg: "ACTIVITIES",
  person: "ACTIVITIES",
  posting_period: "FINANCE",
  workspace: "CORE",
  workspace_module: "CORE",
  workspace_template: "CORE",
} as const satisfies Record<HistoryEntityType, ModuleCode>;

/**
 * No filters and no `sort`: a timeline has one meaningful order, so newest-first
 * is fixed server-side and only the keyset controls travel.
 */
export const historyListQuery = listQuery({});

export const historyActorScopes = ["WORKSPACE", "PLATFORM"] as const;
export const historyActorScope = z.enum(historyActorScopes);

/**
 * `principalId` and `displayName` are null exactly for PLATFORM events: the
 * generated `tenant_actor_principal_id` masks the actor for them, so the
 * principals join yields nothing and the label derives from `scope` alone
 * ("by ROUTIQ").
 */
export const historyActor = z.object({
  principalId: z.uuid().nullable(),
  displayName: z.string().nullable(),
  scope: historyActorScope,
});

export const historyCommandRef = z.object({
  id: z.uuid(),
  name: z.string(),
  version: z.string(),
  origin: z.enum(COMMAND_ORIGINS),
  clientOccurredAt: z.iso.datetime().nullable(),
});

export const historyItem = z.object({
  eventId: z.uuid(),
  /** Open set — the read never enumerates event types; unknown codes render raw. */
  eventType: z.string(),
  occurredAt: z.iso.datetime(),
  actor: historyActor,
  command: historyCommandRef,
  changedFields: z.array(z.string()),
  /**
   * Reopen motifs and correction reasons, lifted server-side from an allowlist
   * of state keys; null when the event carries none. `before_state` and
   * `after_state` themselves stay out of the list — it has to stay light on 2G.
   */
  note: z.string().nullable(),
});

export const historyListResponse = listResponse(historyItem);

export type HistoryListQuery = z.infer<typeof historyListQuery>;
export type HistoryActor = z.infer<typeof historyActor>;
export type HistoryItem = z.infer<typeof historyItem>;
export type HistoryListResponse = z.infer<typeof historyListResponse>;
