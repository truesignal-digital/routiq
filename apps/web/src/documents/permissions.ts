import type { ModuleCode, Role } from "@routiq/contracts";

const DOCUMENT_WRITERS: readonly Role[] = ["ADMIN", "OPS_MANAGER", "FIELD_SUBMITTER"];

export function canAccessDocuments(enabledModules: readonly ModuleCode[] | undefined): boolean {
  return enabledModules?.includes("DOCUMENTS") ?? false;
}

export function canManageDocuments(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return canAccessDocuments(enabledModules) && role !== undefined && DOCUMENT_WRITERS.includes(role);
}
