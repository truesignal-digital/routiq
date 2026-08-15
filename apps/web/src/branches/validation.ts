import { branchCode, branchName } from "@routiq/contracts";

/**
 * Both branch dialogs validate against the command schemas themselves, so a
 * value the form accepts is a value the server accepts. Only the wording is
 * decided here — the rule lives in `packages/contracts`, and the API answers a
 * stable code that the dialog turns into the same sentence.
 */
export const BRANCH_NAME_MAX_LENGTH = branchName.maxLength ?? 120;

export type BranchNameProblem = "required" | "tooLong";

export function branchNameProblem(value: string): BranchNameProblem | undefined {
  const result = branchName.safeParse(value);
  if (result.success) return undefined;
  return result.error.issues.some((issue) => issue.code === "too_big") ? "tooLong" : "required";
}

export function branchCodeProblem(value: string): "invalid" | undefined {
  return branchCode.safeParse(value).success ? undefined : "invalid";
}
