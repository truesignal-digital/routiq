import type { TemplateFieldIssue } from "@asset/contracts";

type Translate = (key: string) => string;
type SetFieldError = (field: string, message: string) => void;

/** Map TEMPLATE_FIELD_INVALID metadata onto customValues.* fields. */
export function applyTemplateFieldMetadata(
  metadata: Record<string, unknown> | undefined,
  t: Translate,
  setError: SetFieldError,
): number {
  if (metadata === undefined) return 0;
  let applied = 0;
  const apply = (key: string, kind: TemplateFieldIssue["kind"]) => {
    setError(`customValues.${key}`, t(`assets.form.fieldErrors.${kind}`));
    applied += 1;
  };
  if (Array.isArray(metadata["missingRequired"])) {
    for (const key of metadata["missingRequired"]) {
      if (typeof key === "string") apply(key, "required");
    }
  }
  if (Array.isArray(metadata["wrongType"])) {
    for (const entry of metadata["wrongType"]) {
      const key = (entry as { key?: unknown }).key;
      if (typeof key === "string") apply(key, "wrongType");
    }
  }
  if (Array.isArray(metadata["unknownKeys"])) {
    for (const key of metadata["unknownKeys"]) {
      if (typeof key === "string") apply(key, "unknown");
    }
  }
  return applied;
}

/** Map VALIDATION_FAILED metadata ({issues: [{code, path}]}) onto fields. */
export function applyValidationMetadata(
  metadata: Record<string, unknown> | undefined,
  t: Translate,
  setError: SetFieldError,
): number {
  const issues = metadata?.["issues"];
  if (!Array.isArray(issues)) return 0;
  let applied = 0;
  for (const issue of issues) {
    const path = (issue as { path?: unknown }).path;
    if (Array.isArray(path) && path.length > 0 && path.every((p) => typeof p === "string" || typeof p === "number")) {
      setError(path.join("."), t("form.errors.invalid"));
      applied += 1;
    }
  }
  return applied;
}
