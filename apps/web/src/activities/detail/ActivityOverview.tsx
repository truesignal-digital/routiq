import type { ActivityDetail } from "@routiq/contracts";
import { useTranslation } from "react-i18next";
import { MetricStrip, type MetricTile, type MetricTiles } from "@/components/metric-strip.js";
import { formatDateTime, formatMoney } from "@/lib/format.js";
import { postedNetMinor } from "./ActivityMoney.js";

export type ActivityOverviewData = Pick<
  ActivityDetail,
  "status" | "startedAt" | "endedAt" | "legCount" | "financialEntries"
>;

export interface ActivityOverviewProps {
  activity: ActivityOverviewData;
}

/**
 * The four facts a reader wants before scrolling. Crew is left to the assets
 * panel, which names every member — a count beside the names would be the same
 * fact twice, and the strip stops at four tiles.
 */
export function ActivityOverview({ activity }: ActivityOverviewProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const running = activity.endedAt === null && activity.status === "OPEN";

  const started: MetricTile = {
    label: t("activities.detail.overview.started"),
    value:
      activity.startedAt === null ? null : formatDateTime(activity.startedAt, locale),
  };
  const ended: MetricTile = {
    label: t("activities.detail.overview.ended"),
    value: running
      ? t("activities.detail.overview.running")
      : activity.endedAt === null
        ? null
        : formatDateTime(activity.endedAt, locale),
    ...(running ? { tone: "warning" as const } : {}),
  };
  const legs: MetricTile = {
    label: t("activities.detail.overview.legs"),
    value: new Intl.NumberFormat(locale).format(activity.legCount),
  };

  // No net for a reader the server kept the ledger from (#103).
  if (activity.financialEntries === null) {
    return <MetricStrip tiles={[started, ended, legs]} />;
  }

  const net = postedNetMinor(activity.financialEntries);
  const tiles: MetricTiles = [
    started,
    ended,
    {
      label: t("activities.detail.overview.net"),
      // The sign is spelled out, never left to colour alone; a job that lost
      // money is exactly the tile that wants someone's attention.
      value: formatMoney(net, { locale, signDisplay: "exceptZero" }),
      hint: t("activities.detail.overview.postedOnly"),
      ...(net < 0 ? { tone: "warning" as const } : {}),
    },
    legs,
  ];

  return <MetricStrip tiles={tiles} />;
}
