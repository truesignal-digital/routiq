import {
  APPROVAL_CHAIN_COMMAND_TYPES,
  type ApprovalChainCommandType,
  type ApprovalChainOutcome,
  type ApprovalChainStep,
  type Role,
} from "@routiq/contracts";
import { approvalRuleChanges } from "../db/schema.js";
import { matchApproval, type ApprovalRuleRow } from "./approvals.js";
import { listCommandDefinitions, type CommandContext, type Tx } from "./dispatcher.js";

/** The roles that may submit this kind of entry, from its handler's `allowedRoles`. */
export function entryRecorderRoles(commandType: ApprovalChainCommandType): readonly Role[] {
  const definition = listCommandDefinitions().find(
    (candidate) => candidate.name === commandType && candidate.scope !== "platform",
  );
  return definition !== undefined && "allowedRoles" in definition ? definition.allowedRoles : [];
}

/** The entry chains a threshold on each command type moves. Work-order bands move none. */
const CHAINS_MOVED: Readonly<Record<string, readonly ApprovalChainCommandType[]>> = {
  "record-expense": ["record-expense"],
  "record-revenue": ["record-revenue"],
  "approve-entry": APPROVAL_CHAIN_COMMAND_TYPES,
};

/**
 * The roles a threshold on these command types moves, and so tells (#422).
 * Direction is left out: its own entries post at any amount, so no band moves
 * them, and the change is Direction's to make.
 */
export function rolesMovedBy(commandTypes: readonly string[]): Role[] {
  const chains = commandTypes.flatMap((commandType) => CHAINS_MOVED[commandType] ?? []);
  return [...new Set(chains.flatMap(entryRecorderRoles))].filter((role) => role !== "DIRECTOR");
}

/** Notes a change to the entry chain so the members it moves are told (#422). */
export async function recordApprovalRuleChange(
  tx: Tx,
  ctx: CommandContext,
  commandId: string,
  commandType: string | readonly string[],
): Promise<void> {
  const affectedRoles = rolesMovedBy(typeof commandType === "string" ? [commandType] : commandType);
  if (affectedRoles.length === 0) return;
  await tx.insert(approvalRuleChanges).values({
    workspaceId: ctx.workspaceId,
    affectedRoles,
    createdByCommandId: commandId,
  });
}

/** Who decides a pending entry, in the order the chain names them (ADR-0009). */
const DECIDERS: ReadonlyArray<readonly ["FINANCE" | "DIRECTOR", ApprovalChainOutcome]> = [
  ["FINANCE", "FINANCE_APPROVES"],
  ["DIRECTOR", "DIRECTION_APPROVES"],
];

/**
 * What happens to `role`'s own entry at each amount, as bands. Computed by
 * running the same matcher the commands run (`matchApproval`) at every amount
 * where a rule starts or stops matching, so the chain shown can never disagree
 * with what recording and deciding do. Workspace-wide rules only: a rule kept
 * to one branch or category is a tenant's exception, not the chain.
 */
export function chainSteps(
  recordRules: readonly ApprovalRuleRow[],
  decisionRules: readonly ApprovalRuleRow[],
  role: Role,
): ApprovalChainStep[] {
  const wide = (rules: readonly ApprovalRuleRow[]) =>
    rules.filter((rule) => rule.branchId === null && rule.categoryCode === null);
  const records = wide(recordRules);
  const decisions = wide(decisionRules);

  const edges = new Set<bigint>();
  for (const rule of [...records, ...decisions]) {
    if (rule.amountMaxMinor !== null && rule.amountMaxMinor >= 1n) edges.add(rule.amountMaxMinor);
    if (rule.amountMinMinor !== null && rule.amountMinMinor > 1n) edges.add(rule.amountMinMinor - 1n);
  }
  const sorted = [...edges].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const last = sorted.at(-1);
  const probes: Array<readonly [bigint, bigint | null]> = [
    ...sorted.map((edge) => [edge, edge] as const),
    [last === undefined ? 1n : last + 1n, null],
  ];

  const outcomeAt = (amountMinor: bigint): ApprovalChainOutcome => {
    if (matchApproval(records, role, { amountMinor }).outcome === "AUTO_APPROVED") {
      return "POSTS_DIRECTLY";
    }
    const decider = DECIDERS.find(
      ([decidingRole]) =>
        matchApproval(decisions, decidingRole, { amountMinor }).outcome === "AUTO_APPROVED",
    );
    if (decider === undefined) return "WAITS";
    // No one decides their own entry (MAKER_CANNOT_APPROVE).
    return decider[0] === "FINANCE" && role === "FINANCE" ? "FINANCE_PEER_APPROVES" : decider[1];
  };

  const steps: ApprovalChainStep[] = [];
  for (const [probe, upTo] of probes) {
    const outcome = outcomeAt(probe);
    const previous = steps.at(-1);
    const upToMinor = upTo === null ? null : Number(upTo);
    if (previous?.outcome === outcome) previous.upToMinor = upToMinor;
    else steps.push({ upToMinor, outcome });
  }
  return steps;
}
