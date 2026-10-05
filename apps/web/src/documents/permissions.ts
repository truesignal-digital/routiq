import { canReadDocuments, type ModuleCode, type Role } from "@routiq/contracts";

const DOCUMENT_WRITERS: readonly Role[] = ["DIRECTOR", "ADMIN", "FINANCE"];

export function canAccessDocuments(enabledModules: readonly ModuleCode[] | undefined): boolean {
  return enabledModules?.includes("DOCUMENTS") ?? false;
}

/** The Documents tab and its fetch: everyone but the counter (ADR-0009), as the server rules. */
export function canViewDocuments(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return canAccessDocuments(enabledModules) && role !== undefined && canReadDocuments(role);
}

export function canManageDocuments(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return canAccessDocuments(enabledModules) && role !== undefined && DOCUMENT_WRITERS.includes(role);
}
