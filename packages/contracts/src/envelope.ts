import { z } from "zod";

/**
 * Common envelope carried by every command, regardless of caller
 * (web form, offline sync, CSV import, future AI agent).
 * Tenant, actor, and branch scope are NEVER accepted from the client —
 * the API derives them server-side from authentication.
 */
export const commandEnvelope = z.object({
  commandId: z.uuid(),
  idempotencyKey: z.string().min(8).max(128),
  origin: z.enum(["HUMAN_UI", "CSV_IMPORT", "OFFLINE_SYNC", "API", "AI_AGENT"]),
  clientOccurredAt: z.iso.datetime({ offset: true }).optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
  sourceArtifactIds: z.array(z.uuid()).default([]),
});

export type CommandEnvelope = z.infer<typeof commandEnvelope>;

/** XAF has exponent 0: 1 XAF = 1 minor unit. Never divide by 100. */
export const moneyMinor = z.number().int();
export const currencyCode = z.literal("XAF");
