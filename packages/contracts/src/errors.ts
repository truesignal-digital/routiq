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
  "UNSUPPORTED_MEDIA_TYPE",
  "STORAGE_FAILED",
  "ASSET_NOT_OPERATIONAL",
  "DOCUMENT_ALREADY_SUPERSEDED",
  "POSTINGS_SUM_MISMATCH",
  "MAKER_CANNOT_APPROVE",
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
  /** Acting on an operational issue that is no longer OPEN. */
  "ISSUE_NOT_OPEN",
  /**
   * A cost posting naming a work order that is not accepting costs — costs
   * attach while APPROVED only. Offline replays are exempt (§6 facts): they
   * commit with the WORK_ORDER_NOT_OPEN_AT_COMMIT warning instead.
   */
  "WORK_ORDER_NOT_OPEN",
  /** A posting (or linked issue) naming an asset other than the work order's. */
  "WORK_ORDER_ASSET_MISMATCH",
  /** release-asset-to-service on an asset with no open availability interval. */
  "NO_OPEN_UNAVAILABILITY",
  /**
   * §5.1: the releaser must not be the performer for safety-critical work —
   * the completion submitter of a linked work order cannot release the asset.
   */
  "RELEASER_CANNOT_BE_PERFORMER",
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
  /** A safety-critical report on an asset whose downtime interval is already open. */
  "ASSET_ALREADY_UNAVAILABLE",
  /**
   * The issue closed (resolved or dismissed) while the downtime interval it
   * opened still stands — Remise en service is a separate decision (§3.4
   * inv. 8), so the record commits and the UI shows both states.
   */
  "ISSUE_CLOSED_ASSET_STILL_UNAVAILABLE",
  /** The mirror ordering: released to service while the opening issue is still OPEN. */
  "ASSET_RELEASED_ISSUE_STILL_OPEN",
  /** Cancelled with net posted costs ≠ 0 — the spend stands, attributed to asset + WO. */
  "WORK_ORDER_CANCELLED_WITH_COSTS",
  /**
   * An offline-captured cost replayed after its work order left APPROVED (§6).
   * The record commits; the receipt keeps the discrepancy for reconciliation.
   */
  "WORK_ORDER_NOT_OPEN_AT_COMMIT",
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
