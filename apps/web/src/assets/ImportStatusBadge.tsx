import { useTranslation } from "react-i18next";
import { StatusBadge, type StatusBadgeTone } from "@/components/status-badge.js";

/** A row of a vehicle import (#747): its preview verdict, then what sending it did. */
export type ImportRowStatus = "ready" | "error" | "created" | "replayed" | "approval" | "failed";

const IMPORT_ROW_STATUS: Record<ImportRowStatus, StatusBadgeTone> = {
  ready: "success",
  error: "danger",
  created: "success",
  replayed: "neutral",
  approval: "warning",
  failed: "danger",
};

export function ImportStatusBadge({ status }: { status: ImportRowStatus }) {
  const { t } = useTranslation();
  return <StatusBadge tone={IMPORT_ROW_STATUS[status]}>{t(`assets.import.status.${status}`)}</StatusBadge>;
}
