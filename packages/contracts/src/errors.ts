/**
 * Stable machine-readable API error codes. Clients localize (fr-CM default);
 * the API never sends human-language sentences.
 */
export const AUTH_ERROR_CODES = [
  "AUTH_REQUIRED",
  "AUTH_INVALID_TOKEN",
  "AUTH_INVALID_CREDENTIALS",
  "AUTH_LOCKED",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export const VALIDATION_ERROR_CODES = ["VALIDATION_FAILED"] as const;

export type ValidationErrorCode = (typeof VALIDATION_ERROR_CODES)[number];

/** A sender past its per-minute telemetry allowance (`POST /v1/telemetry`, ADR-0011). */
export const TELEMETRY_ERROR_CODES = ["RATE_LIMITED"] as const;

export type TelemetryErrorCode = (typeof TELEMETRY_ERROR_CODES)[number];

export const COMMAND_ERROR_CODES = [
  "COMMAND_NOT_FOUND",
  "ROLE_FORBIDDEN",
  "MODULE_DISABLED",
  "APPROVAL_REQUIRED",
  "IDEMPOTENCY_KEY_REUSED",
  "REFERENCE_NOT_FOUND",
  "DUPLICATE_ASSET_CODE",
  "DUPLICATE_BRANCH_CODE",
  /**
   * A branch name already in use in this workspace (`branches_ws_name_uq`). The
   * name identifies the branch across the shell — switcher, scope line, toast —
   * so it has to be as unique as the code.
   */
  "DUPLICATE_BRANCH_NAME",
  /**
   * A plate another vehicle in this workspace already carries, compared without
   * spaces or case (`LT 482 AB` = `lt482ab`). Checked by `update-asset-details`.
   */
  "DUPLICATE_REGISTRATION_NUMBER",
  "UNIQUE_CONSTRAINT_VIOLATION",
  "COMMAND_FAILED",
  /**
   * A command whose handler returned success without writing an audit event
   * for itself (#153). The dispatcher rolls the whole command back; nothing it
   * wrote is kept. A server bug, never the caller's.
   */
  "AUDIT_EVENT_MISSING",
  "EXPECTED_VERSION_REQUIRED",
  "VERSION_CONFLICT",
  "INVALID_STATE_TRANSITION",
  "TEMPLATE_FIELD_INVALID",
  "ARTIFACT_UPLOAD_INCOMPLETE",
  "ARTIFACT_INTEGRITY_MISMATCH",
  "UNSUPPORTED_MEDIA_TYPE",
  "STORAGE_FAILED",
  "ASSET_NOT_OPERATIONAL",
  "DOCUMENT_ALREADY_SUPERSEDED",
  "POSTINGS_SUM_MISMATCH",
  "MAKER_CANNOT_APPROVE",
  /**
   * `update-approval-threshold` v2 with a recording threshold at or above the
   * Finance ceiling (#354): Finance would have no band left to decide.
   */
  "RECORDING_THRESHOLD_NOT_BELOW_CEILING",
  /**
   * Editing a pending entry someone else recorded (#85). Only its author may
   * change it while it waits; anyone else with the right role rejects it.
   */
  "NOT_ENTRY_AUTHOR",
  /**
   * A role the roles reference limits to its own records acting on someone
   * else's: a DRIVER closing or swapping the vehicle on a trip another person
   * recorded, a DRIVER or TECHNICIAN attaching a file to another person's entry.
   */
  "OWN_RECORDS_ONLY",
  "ENTRY_ALREADY_REVERSED",
  /**
   * Reversing an entry that is itself a reversal (#130). Reversal is one level
   * only; a mistaken reversal is undone by recording the entry again.
   */
  "ENTRY_IS_REVERSAL",
  "PERIOD_LOCKED",
  "CATEGORY_KIND_MISMATCH",
  "ACTIVITY_CLOSE_BLOCKED",
  "COMMAND_SCOPE_FORBIDDEN",
  "DUPLICATE_WORKSPACE_SLUG",
  "PRESET_DISABLED",
  "DUPLICATE_CATEGORY_CODE",
  "CATEGORY_LAYER_INVALID",
  "CATEGORY_ALREADY_INACTIVE",
  "CATEGORY_ALREADY_ACTIVE",
  "PRESET_ALREADY_SET",
  "LAST_PRESET",
  /** A username already exists in this workspace (`credentials_ws_username_uq`). */
  "USERNAME_TAKEN",
  /** Demoting or deactivating the workspace's only remaining active DIRECTOR. */
  "LAST_DIRECTOR",
  /** An admin deactivating their own membership — the lockout foot-gun. */
  "SELF_DEACTIVATION",
  /** A member changing their own role or branches (ADR-0009: nobody changes their own role). */
  "SELF_ROLE_CHANGE",
  /**
   * A member command on a role the actor may not manage: an ADMIN gives,
   * changes or removes only DRIVER, TECHNICIAN and CASHIER, and no tenant
   * command gives, changes or removes DIRECTOR. Checked on both the member's
   * current role and the new one.
   */
  "MEMBER_ROLE_NOT_GRANTABLE",
  /** An ADMIN reaching a member, or a branch scope, outside their own branches. */
  "MEMBER_BRANCH_OUT_OF_SCOPE",
  /** DIRECTOR always covers every branch, so its branch scope can only be ALL. */
  "DIRECTOR_REQUIRES_ALL_BRANCHES",
  /** Deactivating the workspace's only remaining active branch. */
  "LAST_BRANCH",
  /** A new record targeting a branch that has been deactivated. */
  "BRANCH_INACTIVE",
  /** A branch status flip that would change nothing — the caller's list is stale. */
  "BRANCH_STATUS_ALREADY_SET",
  /**
   * A work order naming an operational issue reported against a different
   * asset. Both rows are in the workspace, so the composite tenant FK is
   * satisfied and only the command layer can catch it.
   */
  "ISSUE_ASSET_MISMATCH",
  /**
   * A work order that belongs to a different asset than the record naming it:
   * a release citing another truck's repair, or a cost posting whose assetId
   * and workOrderId point at two different vehicles.
   */
  "WORK_ORDER_ASSET_MISMATCH",
  /**
   * Releasing an asset with no COMPLETED work order answering the signalement
   * that grounded it. Completion is what says the repair is finished and, above
   * the band, that its cost was accepted; without it the release would put an
   * unrepaired truck back on the road. `metadata.overrideAllowed` says whether
   * the grounding signalement is already closed, which is the one case an
   * explicit override reason can stand in for the work order.
   */
  "WORK_ORDER_NOT_COMPLETED",
  /**
   * A release citing a completed work order that does not answer the
   * signalement behind the current grounding — an older repair, or preventive
   * work, cannot vouch for a fault it was never about.
   */
  "WORK_ORDER_ISSUE_MISMATCH",
  /**
   * A cost attributed to a work order that is not APPROVED (#28): pending work
   * has not been authorized, and completed, rejected or cancelled work is closed
   * to new spend. Reversals are exempt — they correct what already stands.
   */
  "WORK_ORDER_NOT_OPEN",
  /**
   * A revenue line naming a work order (#432). A work order collects what a
   * repair cost; money coming in is never one of its lines, whoever records it.
   */
  "WORK_ORDER_COST_ONLY",
  /**
   * A close that says its cost is in the books (`costOutcome: LINES`) when the
   * order has no cost recorded and the close carries none (#81). Closing is
   * where money is declared; "no cost" is its own explicit choice.
   */
  "WORK_ORDER_COST_MISSING",
  /**
   * A close declaring the repair cost nothing (`costOutcome: NO_COST`) while the
   * order already carries recorded cost — someone added a line since the form
   * was opened. The closer reopens the form and sees it.
   */
  "WORK_ORDER_HAS_COSTS",
  /**
   * A command reserved for a human principal — release to service (§5.1:
   * "never AI") — called by an AI agent or an integration.
   */
  "HUMAN_PRINCIPAL_REQUIRED",
  /**
   * Releasing an asset that holds no open availability interval — it was never
   * taken out of service, or someone released it first.
   */
  "ASSET_NOT_UNAVAILABLE",
  /**
   * The member who declared the work complete — or who closed the grounding
   * signalement themselves — trying to release the asset, after a
   * safety-critical report. Two pairs of eyes before a truck flagged unsafe
   * carries passengers again.
   */
  "SELF_RELEASE_FORBIDDEN",
  /**
   * Releasing a vehicle while a safety-critical signalement OTHER than the one
   * that grounded it is still OPEN. A second safety-critical report on a truck
   * already down opens no interval of its own, so the release is the last point
   * where it can hold the truck back. `metadata.openIssueIds` lists them; each
   * has to be resolved or dismissed first. Applies to the override path too.
   */
  "SAFETY_ISSUE_OPEN",
  /**
   * A custodian who cannot hold the vehicle: `metadata.reason` is DEACTIVATED
   * (the membership was revoked) or OUT_OF_SCOPE (their branches do not cover
   * the vehicle's branch after the move).
   */
  "CUSTODIAN_INELIGIBLE",
  /**
   * A severity change that would change nothing (#96): marking safety-critical
   * a problem already marked so, or taking the mark off one that has none. The
   * caller's screen is stale.
   */
  "ISSUE_SEVERITY_ALREADY_SET",
  /**
   * Acknowledging a note that is not Direction's (#98). Only Direction's notes
   * wait in the To-do for someone to say they saw them.
   */
  "NOTE_NOT_FROM_DIRECTION",
  /**
   * Direction acknowledging its own note (#98). The note waits for the team;
   * its author saying "seen" would take it out of the To-do unread.
   */
  "NOTE_AUTHOR_CANNOT_ACKNOWLEDGE",
  /**
   * A planned trip naming a driver who cannot drive it (ADR-0012 §3):
   * `metadata.reason` is INACTIVE (the person is no longer active) or
   * NOT_A_DRIVER (their usual job is not Chauffeur).
   */
  "DRIVER_INELIGIBLE",
  /**
   * Turning a module off while a module that requires it is on (the module
   * manifests' `requires`): Trips while Scheduling is on. `metadata.requiredBy`
   * names them; turn those off first.
   */
  "MODULE_STILL_REQUIRED",
  /**
   * Turning a module on while a module it requires is off: Scheduling while
   * Trips is off. `metadata.requires` names them; turn those on first.
   */
  "MODULE_DEPENDENCY_DISABLED",
] as const;

export type CommandErrorCode = (typeof COMMAND_ERROR_CODES)[number];

/** Stable machine-readable warning codes returned by successful commands. */
export const COMMAND_WARNING_CODES = [
  "EVIDENCE_MISSING",
  "LATE_POSTING",
  "PERIOD_HAS_SUBMITTED_ENTRIES",
  "ACTIVITY_MISSING_START_READING",
  "ACTIVITY_MISSING_END_READING",
  "ACTIVITY_NO_LEGS",
  "ACTIVITY_MISSING_CREW",
  "ACTIVITY_NO_REVENUE",
  "ACTIVITY_OPEN_SEGMENT_AUTOCLOSED",
  "METER_READING_DECREASED",
  "POSTING_DEFERRED_PERIOD_LOCKED",
  /**
   * A fact replayed from an outbox landed in a branch that was deactivated
   * between capture and commit (§6). The record commits; this code is how the
   * command receipt keeps the discrepancy for reconciliation.
   */
  "BRANCH_INACTIVE_AT_COMMIT",
  /**
   * A release that went through on a completed work order while the signalement
   * that grounded the truck is still OPEN — the work was declared done but not
   * the problem. The release stands (#28 decouples the two); the signalement
   * still needs resolving or dismissing.
   */
  "GROUNDING_ISSUE_STILL_OPEN",
  /**
   * The planned vehicle is on another planned or running trip whose booked
   * window overlaps this one (ADR-0012 §4). Warn, don't block: two short runs
   * fit in one day. `warningMetadata.VEHICLE_DOUBLE_BOOKED.tripIds` names them.
   */
  "VEHICLE_DOUBLE_BOOKED",
  /** The same for the planned driver; `warningMetadata.DRIVER_DOUBLE_BOOKED.tripIds`. */
  "DRIVER_DOUBLE_BOOKED",
  /**
   * The planned vehicle is grounded now (an open availability interval). The
   * release, not the booking, is the safety gate, so the booking stands.
   * Only while Maintenance is on.
   */
  "VEHICLE_GROUNDED",
  /** A planned trip started with a vehicle or driver other than the plan (ADR-0012 §5). */
  "TRIP_STARTED_OFF_PLAN",
  /**
   * An offline start replayed onto a trip the office had cancelled (ADR-0012
   * §5). The truck left, so the trip is revived; this code is also kept on
   * the trip's `discrepancy_codes`.
   */
  "TRIP_STARTED_AFTER_CANCELLATION",
] as const;

export type CommandWarningCode = (typeof COMMAND_WARNING_CODES)[number];

/**
 * The subset of warning codes an activity close may record on the row
 * (`activities.completeness_codes`) as well as return. One vocabulary, not two:
 * membership is proven at compile time by the satisfies below, so a code can
 * never exist on the row without also being a legal API warning.
 */
export const ACTIVITY_COMPLETENESS_CODES = [
  "ACTIVITY_MISSING_START_READING",
  "ACTIVITY_MISSING_END_READING",
  "ACTIVITY_NO_LEGS",
  "ACTIVITY_MISSING_CREW",
  "ACTIVITY_NO_REVENUE",
  "ACTIVITY_OPEN_SEGMENT_AUTOCLOSED",
] as const satisfies readonly CommandWarningCode[];

export type ActivityCompletenessCode = (typeof ACTIVITY_COMPLETENESS_CODES)[number];

/**
 * The warning codes a trip keeps forever on `activities.discrepancy_codes`
 * (ADR-0012 §1, §5), the same one-vocabulary rule as completeness codes.
 */
export const TRIP_DISCREPANCY_CODES = [
  "TRIP_STARTED_AFTER_CANCELLATION",
] as const satisfies readonly CommandWarningCode[];

export type TripDiscrepancyCode = (typeof TRIP_DISCREPANCY_CODES)[number];

export type ApiErrorCode = AuthErrorCode | ValidationErrorCode | CommandErrorCode;

export interface ApiError {
  error: { code: ApiErrorCode; metadata?: Record<string, unknown> };
}
