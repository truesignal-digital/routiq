import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

/**
 * Vendor-operator command (platform scope) that makes an existing member of a
 * workspace its DIRECTOR. No tenant role may grant DIRECTOR to someone who is
 * not one already, and the ADR-0009 migration left existing workspaces with
 * none, so the first one is appointed from outside the tenant. Addressed by
 * slug and username, the handles an operator is given.
 */
export const appointDirectorPayload = z.strictObject({
  workspaceSlug: z.string().min(1).max(80),
  username: z.string().min(1).max(80),
});

export const appointDirectorCommand = z.object({
  name: z.literal("appoint-director"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: appointDirectorPayload,
});

export type AppointDirectorPayload = z.infer<typeof appointDirectorPayload>;
export type AppointDirectorCommand = z.infer<typeof appointDirectorCommand>;
