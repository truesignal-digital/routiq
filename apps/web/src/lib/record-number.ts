import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

/**
 * The maintenance records that carry a number of their own (#608). Core, not
 * the Maintenance module's: the vehicle record's frame (header, panel, lock
 * reasons) names them too.
 */
export type NumberedRecordKind = "work_order" | "issue";

/** A work order or problem as a reader names it: its kind and the server's number. */
export interface NumberedRecord {
  kind: NumberedRecordKind;
  /** Null until the server has numbered the record (captured offline, not yet synced). */
  number: number | null;
}

const KEYS = {
  work_order: "common.recordNumber.workOrder",
  issue: "common.recordNumber.issue",
} as const;

/**
 * "OT-0007" / "WO-0007". The server draws the integer when the creating
 * command commits; the prefix is each language's, kept in the catalogs. The
 * number goes in as text, padded, so no locale groups its thousands.
 */
export function recordNumberText(
  t: TFunction,
  kind: NumberedRecordKind,
  number: number | null | undefined,
): string {
  if (number === null || number === undefined) return t("common.recordNumber.pending");
  return t(KEYS[kind], { number: String(number).padStart(4, "0") });
}

/** `recordNumberText` bound to the reader's language. */
export function useRecordNumber(): (kind: NumberedRecordKind, number: number | null | undefined) => string {
  const { t } = useTranslation();
  return (kind, number) => recordNumberText(t, kind, number);
}
