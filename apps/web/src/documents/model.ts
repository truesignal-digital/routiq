import type { AssetDocumentRead } from "@routiq/contracts";

export type AssetDocument = AssetDocumentRead;

export type ExpiryState = "expired" | "expiringSoon" | "ok" | "none";

/** Client-side badge only — the server (document expiry scan) stays the source of truth. */
export function expiryState(expiresAt: string | null, today: Date, soonDays = 30): ExpiryState {
  if (expiresAt === null) return "none";
  const expiry = new Date(`${expiresAt}T00:00:00`);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (expiry < startOfToday) return "expired";
  const soon = new Date(startOfToday);
  soon.setDate(soon.getDate() + soonDays);
  return expiry <= soon ? "expiringSoon" : "ok";
}

export interface DocumentGroup {
  type: AssetDocument["type"];
  current: AssetDocument[];
  superseded: AssetDocument[];
}

/** Form fields copied into a renewal before the clerk updates them. */
export function renewalDefaults(document: AssetDocument | undefined) {
  return {
    typeCode: document?.type.code ?? "",
    title: document?.title ?? "",
    documentNumber: document?.documentNumber ?? "",
    issuedAt: document?.issuedAt ?? "",
    expiresAt: document?.expiresAt ?? "",
  };
}

/** Group by type; a document is current iff nothing supersedes it. */
export function groupDocuments(docs: AssetDocument[]): DocumentGroup[] {
  const groups = new Map<string, DocumentGroup>();
  for (const doc of docs) {
    let group = groups.get(doc.type.code);
    if (!group) {
      group = { type: doc.type, current: [], superseded: [] };
      groups.set(doc.type.code, group);
    }
    (doc.supersededByDocumentId === null ? group.current : group.superseded).push(doc);
  }
  return [...groups.values()];
}
