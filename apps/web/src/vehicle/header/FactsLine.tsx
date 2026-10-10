import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatRelativeTime } from "@/lib/format.js";
import { useVehicle } from "../context.js";
import { LinkButton, withNodes } from "../parts.js";

/** The quiet facts for the header's facts line; the Details section holds the rest. */
export function useFactsLine(): ReactNode[] {
  const { t, i18n } = useTranslation();
  const { asset, gates, panel } = useVehicle();
  const locale = i18n.language;
  const reading = asset.lastReading;

  const custodian = withNodes((slots) => t("vehicle.facts.custodian", slots), {
    name: (
      <span className="font-medium text-foreground">
        {asset.custodian?.displayName ?? t("vehicle.facts.nobody")}
      </span>
    ),
  });

  const readingFact =
    reading === null
      ? t("vehicle.facts.noReading")
      : withNodes(
          (slots) =>
            t("vehicle.facts.reading", {
              ...slots,
              readingType: reading.readingType,
              ago: formatRelativeTime(reading.observedAt, locale),
            }),
          {
            value: (
              <LinkButton onClick={() => panel.openRecord({ kind: "readings" })}>
                {t("vehicle.facts.readingValue", {
                  readingType: reading.readingType,
                  value: reading.value,
                })}
              </LinkButton>
            ),
          },
        );

  const lifecycle = withNodes(
    (slots) =>
      asset.commissionedAt === null
        ? slots["status"] ?? ""
        : t("vehicle.facts.lifecycleSince", {
            ...slots,
            since: new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" }).format(
              new Date(asset.commissionedAt),
            ),
          }),
    {
      status: (
        <span className="font-medium text-foreground">{t(`assets.status.${asset.lifecycleStatus}`)}</span>
      ),
    },
  );

  return [
    <span key="custodian">{custodian}</span>,
    ...(gates.trips ? [<span key="reading">{readingFact}</span>] : []),
    <span key="location">{t("vehicle.facts.locationNoReport")}</span>,
    <span key="lifecycle">{lifecycle}</span>,
  ];
}
