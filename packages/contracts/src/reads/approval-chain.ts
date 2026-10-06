import { z } from "zod";
import { moneyMinor } from "../envelope.js";

/** The entry kinds a chain is shown for: the ones the record forms submit. */
export const APPROVAL_CHAIN_COMMAND_TYPES = ["record-expense", "record-revenue"] as const;

/**
 * What happens to the caller's own entry in one amount band. Direction is the
 * role's team word (ADR-0009). FINANCE_PEER_APPROVES is Finance's band seen by
 * a Finance member: no one decides their own entry, so a colleague or
 * Direction does. WAITS is a band no role on the chain decides, which only a
 * hand-edited rule set can produce.
 */
export const APPROVAL_CHAIN_OUTCOMES = [
  "POSTS_DIRECTLY",
  "FINANCE_APPROVES",
  "FINANCE_PEER_APPROVES",
  "DIRECTION_APPROVES",
  "WAITS",
] as const;

/** One band, from the previous step's `upToMinor` (exclusive) up to this one (inclusive). */
export const approvalChainStep = z.object({
  /** Null on the last step: every amount above the previous one. */
  upToMinor: moneyMinor.nullable(),
  outcome: z.enum(APPROVAL_CHAIN_OUTCOMES),
});

export const approvalChain = z.object({
  commandType: z.enum(APPROVAL_CHAIN_COMMAND_TYPES),
  steps: z.array(approvalChainStep),
});

/**
 * The approval-rule change the caller has not acknowledged yet (#422). Only
 * the latest change that touched their role, so a member back after several
 * changes reads the current rules once.
 */
export const approvalRulesNotice = z.object({
  changeId: z.uuid(),
  changedAt: z.iso.datetime(),
  /** Null when ROUTIQ changed the rules itself (a release), not a member. */
  changedBy: z.string().nullable(),
});

/** `GET /v1/approval-chain`: the caller's own chain, and the notice to show. */
export const approvalChainResponse = z.object({
  currency: z.string(),
  chains: z.array(approvalChain),
  notice: approvalRulesNotice.nullable(),
});

export type ApprovalChainCommandType = (typeof APPROVAL_CHAIN_COMMAND_TYPES)[number];
export type ApprovalChainOutcome = (typeof APPROVAL_CHAIN_OUTCOMES)[number];
export type ApprovalChainStep = z.infer<typeof approvalChainStep>;
export type ApprovalChain = z.infer<typeof approvalChain>;
export type ApprovalRulesNotice = z.infer<typeof approvalRulesNotice>;
export type ApprovalChainResponse = z.infer<typeof approvalChainResponse>;
