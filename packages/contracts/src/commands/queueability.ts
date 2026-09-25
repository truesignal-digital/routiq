/**
 * §6's facts-vs-decisions rule, as data the client can act on.
 *
 * Physical facts captured offline are accepted with a discrepancy flag — a part
 * already left the shelf and a truck already made the trip; the server does not
 * get to reject reality. Decisions (approvals, locks, release-to-service,
 * disposal, activity close) always need a server round trip, so attempting one
 * offline must render "connexion requise", not an error.
 */
export const COMMAND_QUEUEABILITY = {
  // Facts — safe to hold in the outbox and replay.
  "register-asset": true,
  "add-or-renew-document": true,
  "assign-asset": true,
  "register-person": true,
  "create-activity": true,
  "record-movement-leg": true,
  "record-meter-reading": true,
  "substitute-asset": true,
  "record-journey-sheet": true,
  "record-haulage-job-sheet": true,
  "record-expense": true,
  "record-revenue": true,
  "report-issue": true,
  "create-work-order": true,
  "complete-work-order": true,

  /*
   * Decisions — never queued.
   *
   * close-activity is listed in §6 by name. The sheets are queueable even though
   * they close the activity they create, and that is not a contradiction worth
   * rediscovering later: closing a job you did not create in the same
   * transaction is a judgement on a record whose current state the operator must
   * see. Transcribing a completed paper waybill is bookkeeping.
   */
  "close-activity": false,
  "reopen-activity": false,
  "commission-asset": false,
  "approve-entry": false,
  "reject-entry": false,
  "reverse-entry": false,
  "lock-period": false,
  "reopen-period": false,
  "enable-module": false,
  "disable-module": false,
  "update-approval-threshold": false,
  "create-category": false,
  "relabel-category": false,
  "deactivate-category": false,
  "reactivate-category": false,
  "set-template-preset": false,
  "create-branch": false,
  /*
   * Branch administration is a decision about where the workspace operates, and
   * a queued one settles the wrong way round: a deactivation replayed an hour
   * later would accept records into a branch the admin had already closed, and
   * the last-active-branch invariant is counted against state the device never
   * saw.
   */
  "rename-branch": false,
  "set-branch-status": false,

  /*
   * Member administration is decisions all the way down. Granting a login,
   * changing what someone may approve and revoking access are judgements about
   * who the workspace trusts, and each is a race only the server can settle: a
   * queued deactivation replayed an hour later would leave a revoked member
   * working in the meantime, and a queued role change could demote the last
   * admin against state the device never saw.
   */
  "add-member": false,
  "update-member-role": false,
  "deactivate-member": false,
  "reactivate-member": false,
  "reset-member-pin": false,
  "cancel-work-order": false,
  "release-asset-to-service": false,

  /*
   * The two work-order decisions. A creation or a completion is a fact the
   * workshop can capture offline; deciding that the spend is authorized and
   * that the declared costs are accepted is a judgement about a record whose
   * current state the approver must see. Queuing either would let an approval
   * replayed an hour later land on a work order that had since been cancelled.
   */
  "approve-work-order": false,
  "approve-work-order-closure": false,
} as const satisfies Record<string, boolean>;

export type QueueableCommandName = keyof typeof COMMAND_QUEUEABILITY;

export function isQueueable(commandName: string): boolean {
  return (
    COMMAND_QUEUEABILITY[commandName as QueueableCommandName] ??
    // Unknown commands are decisions until declared otherwise: a command that
    // slipped through undeclared must not be silently trusted to an outbox.
    false
  );
}
