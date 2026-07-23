/**
 * Stable machine-readable API error codes. Clients localize (fr-CM default);
 * the API never sends human-language sentences.
 */
export const AUTH_ERROR_CODES = [
  "AUTH_REQUIRED",
  "AUTH_INVALID_TOKEN",
  "AUTH_INVALID_CREDENTIALS",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export const VALIDATION_ERROR_CODES = ["VALIDATION_FAILED"] as const;

export type ValidationErrorCode = (typeof VALIDATION_ERROR_CODES)[number];

export const COMMAND_ERROR_CODES = [
  "COMMAND_NOT_FOUND",
  "ROLE_FORBIDDEN",
  "IDEMPOTENCY_KEY_REUSED",
  "REFERENCE_NOT_FOUND",
  "DUPLICATE_ASSET_CODE",
  "UNIQUE_CONSTRAINT_VIOLATION",
  "COMMAND_FAILED",
] as const;

export type CommandErrorCode = (typeof COMMAND_ERROR_CODES)[number];

export type ApiErrorCode = AuthErrorCode | ValidationErrorCode | CommandErrorCode;

export interface ApiError {
  error: { code: ApiErrorCode; metadata?: Record<string, unknown> };
}
