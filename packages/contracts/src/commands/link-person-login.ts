import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

/**
 * Gives a Person their login (ADR-0010): the person's records, such as the
 * trips they are planned for or crew on, become the login's own. The same
 * command relinks a person who already has a login to a different one; the
 * earlier link is ended, never rewritten, so who held which login stays on
 * record. Sent at the person's `expectedVersion`.
 *
 * The login is named by `principalId`, the key every member command and the
 * members read use. The membership row is resolved by the server.
 */
export const linkPersonLoginPayload = z.strictObject({
  personId: z.uuid(),
  principalId: z.uuid(),
});

export const linkPersonLoginCommand = z.object({
  name: z.literal("link-person-login"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: linkPersonLoginPayload,
});

export type LinkPersonLoginPayload = z.infer<typeof linkPersonLoginPayload>;
export type LinkPersonLoginCommand = z.infer<typeof linkPersonLoginCommand>;
