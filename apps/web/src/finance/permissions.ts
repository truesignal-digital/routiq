import type { ModuleCode, Role } from "@routiq/contracts";

const FINANCE_WRITERS: readonly Role[] = [
  "ADMIN",
  "OPS_MANAGER",
  "FINANCE_APPROVER",
  "FIELD_SUBMITTER",
];

export function canRecordFinance(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return (
    (enabledModules?.includes("FINANCE") ?? false) &&
    role !== undefined &&
    FINANCE_WRITERS.includes(role)
  );
}
