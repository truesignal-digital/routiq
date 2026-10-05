import { Circle, CircleCheck, CircleX, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { StatusBadge, type StatusBadgeTone } from "@/components/status-badge.js";
import { daysLeft, expiryState, type AssetDocument, type ExpiryState } from "./model.js";

/** Expired, expiring in N days, valid, or no expiry date — never "valid" by default. */
export function DocumentStatusBadge({
  doc,
}: {
  doc: Pick<AssetDocument, "expiresAt" | "supersededByDocumentId">;
}) {
  const { t } = useTranslation();
  const now = new Date();
  if (doc.supersededByDocumentId !== null) {
    return <StatusBadge tone="neutral">{t("vehicle.documents.superseded")}</StatusBadge>;
  }
  switch (expiryState(doc.expiresAt, now)) {
    case "expired":
      return (
        <StatusBadge tone="danger" icon={CircleX}>
          {t("vehicle.documents.expired")}
        </StatusBadge>
      );
    case "expiringSoon":
      return (
        <StatusBadge tone="warning" icon={Clock}>
          {t("vehicle.documents.expiresIn", { count: daysLeft(doc.expiresAt ?? "", now) })}
        </StatusBadge>
      );
    case "ok":
      return (
        <StatusBadge tone="success" icon={CircleCheck}>
          {t("vehicle.documents.valid")}
        </StatusBadge>
      );
    case "none":
      return (
        <StatusBadge tone="neutral" icon={Circle}>
          {t("vehicle.documents.noExpiry")}
        </StatusBadge>
      );
  }
}

/** Row icons stay quiet unless the document needs renewing. */
export function documentIconTone(state: ExpiryState): StatusBadgeTone {
  return state === "expired" ? "danger" : state === "expiringSoon" ? "warning" : "neutral";
}
