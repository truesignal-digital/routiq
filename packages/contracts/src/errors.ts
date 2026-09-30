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
  "UNIQUE_CONSTRAINT_VIOLATION",
  "COMMAND_FAILED",
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
   * Editing a pending entry someone else recorded (#85). Only its author may
   * change it while it waits; anyone else with the right role rejects it.
   */
  "NOT_ENTRY_AUTHOR",
  "ENTRY_ALREADY_REVERSED",
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
  /** Demoting or deactivating the workspace's only remaining active ADMIN. */
  "LAST_ADMIN",
  /** An admin deactivating their own membership — the lockout foot-gun. */
  "SELF_DEACTIVATION",
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

export type ApiErrorCode = AuthErrorCode | ValidationErrorCode | CommandErrorCode;

export interface ApiError {
  error: { code: ApiErrorCode; metadata?: Record<string, unknown> };
}
