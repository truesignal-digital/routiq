import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

/**
 * Drivers, conductors and mechanics — §3.1's Person, who usually has no login.
 * Deliberately a command rather than a resolve-by-name: compensation postings
 * attribute money to a person id, so a typo must not be able to silently split
 * one worker's pay across two rows.
 */
export const registerPersonPayload = z.object({
  personId: z.uuid(),
  displayName: z.string().min(1).max(120),
  branchCode: z.string().min(1),
  /** The operator's own staff number, when they keep one. */
  personCode: z.string().min(1).max(40).optional(),
  phone: z.string().min(1).max(40).optional(),
  defaultRole: z
    .enum(["DRIVER", "CONDUCTOR", "ASSISTANT", "RELIEF", "MECHANIC", "CLERK", "OTHER"])
    .optional(),
});

export const registerPersonCommand = z.object({
  name: z.literal("register-person"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: registerPersonPayload,
});

export type RegisterPersonCommand = z.infer<typeof registerPersonCommand>;
