import { useTranslation } from "react-i18next";
import { CircleCheck, Hourglass, ShieldAlert } from "lucide-react";
import { StatusBadge } from "@/components/status-badge.js";
import { useVehicle } from "./context.js";
import { situationOf } from "./flow.js";

/**
 * The truck's status badge beside its code in the record header (#662): the
 * same situation the status block puts in a sentence, in a word or two.
 * Lifecycle first (a sold truck is not "available"), then availability.
 */
export function VehicleStatusBadge({ now = new Date() }: { now?: Date }) {
  const { t } = useTranslation();
  const { asset, attention } = useVehicle();
  const situation = situationOf(asset, attention, now);

  switch (situation.kind) {
    case "grounded":
      return situation.repaired ? (
        <StatusBadge tone="warning" icon={Hourglass}>
          {t("vehicle.badge.repaired")}
        </StatusBadge>
      ) : (
        <StatusBadge tone="danger" icon={ShieldAlert}>
          {t("vehicle.badge.grounded")}
        </StatusBadge>
      );
    case "available":
      return (
        <StatusBadge tone="success" icon={CircleCheck}>
          {t("vehicle.badge.available")}
        </StatusBadge>
      );
    case "notAssessed":
      return <StatusBadge tone="neutral">{t("vehicle.badge.notAssessed")}</StatusBadge>;
    case "registered":
      return <StatusBadge tone="neutral">{t("assets.status.REGISTERED")}</StatusBadge>;
    case "disposed":
      return <StatusBadge tone="neutral">{t(`assets.status.${situation.status}`)}</StatusBadge>;
  }
}
