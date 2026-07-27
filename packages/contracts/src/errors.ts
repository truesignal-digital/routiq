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
