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
  /*
   * Resolving is the fault fixed on the spot — the mechanic tightened the
   * clamp on a roadside with no signal, and that happened whether or not the
   * server hears about it for an hour. The version it quotes still decides a
   * race with a dismissal.
   */
  "resolve-issue": true,
  "create-work-order": true,
  "complete-work-order": true,
  /* A remark written in the yard with no signal is still what the driver saw. */
  "add-note": true,
  /*
   * A receipt photographed offline is a fact about a spend already recorded;
   * attaching it changes nothing the entry says, so a late replay is harmless.
   */
  "attach-evidence": true,
  /*
   * Planned trips (ADR-0012 §5). A booking creates a new record with client
   * ids nobody else can have touched, like create-work-order; collisions come
   * back as warnings. A start is the truck leaving, which the server does not
   * get to reject.
   */
  "plan-trip": true,
  "start-planned-trip": true,

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
   * An edit of what the vehicle is, made against the version on screen. Held
   * in an outbox it would replay onto a record others may have changed since,
   * and the version check would refuse it anyway; the editor has to see the
   * current values.
   */
  "update-asset-details": false,
  /*
   * Edits of a planned trip against the version on screen, for the same
   * reason: a late replay would overwrite someone else's change or fail on the
   * version. Cancelling is a decision, like cancel-work-order (ADR-0012 §5).
   */
  "assign-trip": false,
  "reschedule-trip": false,
  "update-planned-trip": false,
  "cancel-planned-trip": false,

  /*
   * The two work-order decisions. A creation or a completion is a fact the
   * workshop can capture offline; deciding that the spend is authorized and
   * that the declared costs are accepted is a judgement about a record whose
   * current state the approver must see. Queuing either would let an approval
   * replayed an hour later land on a work order that had since been cancelled.
   */
  "approve-work-order": false,
  "approve-work-order-closure": false,
  /*
   * Their refusing pairs, for the same reason — and a dismissal is a judgement
   * that someone's report was wrong, made against the issue as it stands now.
   */
  "reject-work-order": false,
  "reject-work-order-completion": false,
  "dismiss-issue": false,
  /*
   * Changing the mark on a report someone may be resolving or dismissing right
   * now, quoted against the version on screen: raising grounds the vehicle
   * and lowering overrules a report, so both are judged against the issue as
   * it stands. A driver with no signal reports a new safety-critical problem
   * instead, which is a fact and queues.
   */
  "change-issue-severity": false,
  /*
   * Not a fact about the road but an edit to a record someone else is about to
   * judge. It is valid only while the entry is still pending, and an approver
   * may decide it at any moment; a replay an hour later would meet a conflict
   * the author is no longer there to read. The author edits online, or has it
   * rejected and records it again.
   */
  "update-pending-entry": false,
  /*
   * Says "I have read the rules as they stand now". Replayed later, it could
   * acknowledge a change the member never saw; the notice is a server read
   * anyway, so dismissing it online costs nothing.
   */
  "acknowledge-approval-rules": false,
  /*
   * "I have seen Direction's note" said against the note as it stands, like
   * the rules notice. The To-do is a server read, so it costs nothing to
   * acknowledge online.
   */
  "acknowledge-note": false,
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
