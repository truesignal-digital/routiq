import { z } from "zod";
import { commandEnvelope } from "../envelope.js";
import { ROLES } from "../roles.js";

/**
 * Day-2 member administration. Until these existed a workspace's users were
 * fixed at provisioning time and a hire or a departure meant hand-written SQL.
 *
 * A member is three rows — principal, membership, credential — and every
 * command here moves all of them together, because the alternative is a
 * half-revoked user who can still log in.
 */

/**
 * Branch ids, not codes: these commands are driven by the Users screen, which
 * already holds the branch list it rendered. Provisioning takes codes instead
 * because its branches do not exist yet when its payload is written.
 */
export const memberBranchScope = z.union([
  z.literal("ALL"),
  z.array(z.uuid()).min(1),
]);

/** Long enough to not be guessable in five attempts, short enough to type on a keypad. */
const pin = z.string().min(4).max(64);

const username = z.string().min(1).max(80);

export const addMemberPayload = z.strictObject({
  /** Client-generated, so an offline-drafted form and its retry name the same person. */
  principalId: z.uuid(),
  displayName: z.string().min(1).max(120),
  username,
  pin,
  role: z.enum(ROLES),
  branchScope: memberBranchScope,
});

export const addMemberCommand = z.object({
  name: z.literal("add-member"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: addMemberPayload,
});

/**
 * Role and branch scope are both optional so the screen can send only what the
 * admin actually changed, but sending neither is a no-op dressed as a command —
 * refused here rather than written as an empty audit event.
 */
export const updateMemberRolePayload = z
  .strictObject({
    principalId: z.uuid(),
    role: z.enum(ROLES).optional(),
    branchScope: memberBranchScope.optional(),
  })
  .refine(
    (payload) => payload.role !== undefined || payload.branchScope !== undefined,
    { message: "role or branchScope must be present" },
  );

export const updateMemberRoleCommand = z.object({
  name: z.literal("update-member-role"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: updateMemberRolePayload,
});

export const deactivateMemberPayload = z.strictObject({
  principalId: z.uuid(),
});

export const deactivateMemberCommand = z.object({
  name: z.literal("deactivate-member"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: deactivateMemberPayload,
});

export const reactivateMemberPayload = z.strictObject({
  principalId: z.uuid(),
});

export const reactivateMemberCommand = z.object({
  name: z.literal("reactivate-member"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: reactivateMemberPayload,
});

/**
 * Admin-set, because no email flow exists by design (§6a guard 1) — the admin
 * reads the new PIN to the member. Doubles as the unlock verb: a lockout is
 * cleared by the same act that replaces the forgotten PIN, so there is no
 * separate unlock command to leave a locked-out member waiting on.
 */
export const resetMemberPinPayload = z.strictObject({
  principalId: z.uuid(),
  pin,
});

export const resetMemberPinCommand = z.object({
  name: z.literal("reset-member-pin"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: resetMemberPinPayload,
});

export type MemberBranchScope = z.infer<typeof memberBranchScope>;
export type AddMemberPayload = z.infer<typeof addMemberPayload>;
export type UpdateMemberRolePayload = z.infer<typeof updateMemberRolePayload>;
export type DeactivateMemberPayload = z.infer<typeof deactivateMemberPayload>;
export type ReactivateMemberPayload = z.infer<typeof reactivateMemberPayload>;
export type ResetMemberPinPayload = z.infer<typeof resetMemberPinPayload>;
