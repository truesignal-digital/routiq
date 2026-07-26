import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

export const periodCode = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const lockPeriodPayload = z.object({
  periodCode,
});

export const reopenPeriodPayload = z.object({
  periodCode,
  reason: z.string().min(1).max(500),
});

export const lockPeriodCommand = z.object({
  name: z.literal("lock-period"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: lockPeriodPayload,
});

export const reopenPeriodCommand = z.object({
  name: z.literal("reopen-period"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: reopenPeriodPayload,
});

export type LockPeriodCommand = z.infer<typeof lockPeriodCommand>;
export type ReopenPeriodCommand = z.infer<typeof reopenPeriodCommand>;
