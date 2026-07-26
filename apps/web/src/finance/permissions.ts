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

const ENTRY_REVERSERS: readonly Role[] = ["FINANCE_APPROVER", "ADMIN"];

/** Reverse is only offered on a POSTED entry, to approver roles (maker guard lives server-side). */
export function canReverseEntry(
  role: Role | undefined,
  entryStatus: string | undefined,
): boolean {
  return entryStatus === "POSTED" && role !== undefined && ENTRY_REVERSERS.includes(role);
}
