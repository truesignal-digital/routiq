import type { ActivityDetail } from "@routiq/contracts";
import { useTranslation } from "react-i18next";
import { MetricStrip, type MetricTile, type MetricTiles } from "@/components/metric-strip.js";
import { formatDateTime, profitOrLoss } from "@/lib/format.js";
import { postedNetMinor } from "./ActivityMoney.js";

export type ActivityOverviewData = Pick<
  ActivityDetail,
  "status" | "startedAt" | "endedAt" | "legCount" | "financialEntries"
>;

export interface ActivityOverviewProps {
  activity: ActivityOverviewData;
  /**
   * Whether the reader sees the trip's whole money. A driver gets only the
   * entries they recorded (#264), and a profit over those is no trip's profit.
   */
  showNet: boolean;
}

/**
 * The four facts a reader wants before scrolling. Crew is left to the assets
 * panel, which names every member — a count beside the names would be the same
 * fact twice, and the strip stops at four tiles.
 */
export function ActivityOverview({ activity, showNet }: ActivityOverviewProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  const started: MetricTile = {
    label: t("activities.detail.overview.started"),
    value:
      activity.startedAt === null ? null : formatDateTime(activity.startedAt, locale),
  };
  // The end is a time; whether the trip is still out is the state chip's job (#94).
  const ended: MetricTile = {
    label: t("activities.detail.overview.ended"),
    value: activity.endedAt === null ? null : formatDateTime(activity.endedAt, locale),
  };
  const legs: MetricTile = {
    label: t("activities.detail.overview.legs"),
    value: new Intl.NumberFormat(locale).format(activity.legCount),
  };

  // No profit for a reader the server kept the ledger from (#103).
  if (activity.financialEntries === null || !showNet) {
    return <MetricStrip tiles={[started, ended, legs]} />;
  }

  const result = profitOrLoss(postedNetMinor(activity.financialEntries), { locale });
  const tiles: MetricTiles = [
    started,
    ended,
    {
      // Profit or Loss is spelled out, never left to colour or a minus sign; a
      // job that lost money is exactly the tile that wants someone's attention.
      label: result.label,
      value: result.amount,
      hint: t("activities.detail.overview.postedOnly"),
      ...(result.kind === "loss" ? { tone: "warning" as const } : {}),
    },
    legs,
  ];

  return <MetricStrip tiles={tiles} />;
}
