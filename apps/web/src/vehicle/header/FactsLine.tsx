import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatMonth, formatRelativeTime } from "@/lib/format.js";
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
              <LinkButton
                // 44 px to tap on a phone; the negative margin keeps the facts line's height.
                className="inline-flex min-h-11 items-center -my-2.5 desktop:my-0 desktop:min-h-6"
                onClick={() => panel.openRecord({ kind: "readings" })}
              >
                {t("vehicle.facts.readingValue", {
                  readingType: reading.readingType,
                  value: reading.value,
                })}
              </LinkButton>
            ),
          },
        );

  // In service is the normal case; only another lifecycle state earns a place here (Details has the date).
  const lifecycle =
    asset.lifecycleStatus === "IN_SERVICE"
      ? null
      : withNodes(
          (slots) =>
            asset.commissionedAt === null
              ? slots["status"] ?? ""
              : t("vehicle.facts.lifecycleSince", {
                  ...slots,
                  since: formatMonth(asset.commissionedAt, locale, { month: "short" }),
                }),
          {
            status: (
              <span className="font-medium text-foreground">{t(`assets.status.${asset.lifecycleStatus}`)}</span>
            ),
          },
        );

  // No location is ever reported yet (people report it, there is no GPS): Details says so.
  return [
    <span key="custodian">{custodian}</span>,
    ...(gates.trips ? [<span key="reading">{readingFact}</span>] : []),
    ...(lifecycle === null ? [] : [<span key="lifecycle">{lifecycle}</span>]),
  ];
}
