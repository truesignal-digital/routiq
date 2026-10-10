import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

/**
 * Ends a Person's link to their login. The person, the login and every record
 * either one made stay as they were; the ended link stays on record. Sent at
 * the person's `expectedVersion`.
 */
export const unlinkPersonLoginPayload = z.strictObject({
  personId: z.uuid(),
});

export const unlinkPersonLoginCommand = z.object({
  name: z.literal("unlink-person-login"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: unlinkPersonLoginPayload,
});

export type UnlinkPersonLoginPayload = z.infer<typeof unlinkPersonLoginPayload>;
export type UnlinkPersonLoginCommand = z.infer<typeof unlinkPersonLoginCommand>;
