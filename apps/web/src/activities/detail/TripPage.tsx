import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Route, TriangleAlert } from "lucide-react";
import type { ActivityDetail } from "@routiq/contracts";
import { MetricStrip, type MetricTiles } from "@/components/metric-strip.js";
import { NotRecorded } from "@/components/not-recorded.js";
import { ContextBox, ContextRow, Fact, FactsSection } from "@/components/record-page.js";
import { StatusBadge } from "@/components/status-badge.js";
import type { StatusBlockProps } from "@/components/status-block.js";
import { formatDateTime, formatMoney, localizedLabel } from "@/lib/format.js";
import { postedNetMinor } from "./ActivityMoney.js";

export const TRIP_TABS = ["overview", "legs", "money", "history"] as const;
export type TripTab = (typeof TRIP_TABS)[number];

type Entry = NonNullable<ActivityDetail["financialEntries"]>[number];
type Reading = ActivityDetail["readings"][number];

const IN_THE_BOOKS: ReadonlySet<Entry["status"]> = new Set(["POSTED", "REVERSED"]);

/** Posted revenue and posted expenses, each as a positive sum; reversals subtract. */
export function postedTotals(entries: readonly Entry[]): { revenue: number; expenses: number; revenueLines: number } {
  let revenue = 0;
  let expenses = 0;
  let revenueLines = 0;
  for (const entry of entries) {
    if (!IN_THE_BOOKS.has(entry.status)) continue;
    if (entry.direction === "REVENUE") {
      revenue += entry.amountMinor;
      revenueLines += 1;
    } else {
      expenses += entry.amountMinor;
    }
  }
  return { revenue, expenses, revenueLines };
}

/** The carriers' meter at departure and at arrival: the readings the completeness check looks for. */
export function tripReadings(activity: Pick<ActivityDetail, "segments" | "readings">): {
  start: Reading | undefined;
  end: Reading | undefined;
} {
  const carriers = activity.segments.filter((segment) => segment.role === "PRIMARY" || segment.role === "SUBSTITUTE");
  const live = activity.readings.filter((reading) => reading.supersededById === null);
  const first = carriers[0];
  const last = carriers[carriers.length - 1];
  const at = (source: Reading["source"], assetId: string | undefined) =>
    live.find((reading) => reading.source === source && reading.assetId === assetId);
  return { start: at("ACTIVITY_START", first?.assetId), end: at("ACTIVITY_END", last?.assetId) };
}

/**
 * The status block's sentence for a trip: on the road, waiting to be closed;
 * or closed with things missing, which only a reopen can fill. Nothing for a
 * complete trip.
 */
export function useTripStatus(
  activity: ActivityDetail,
  actions: { close: ReactNode; complete: ReactNode },
): Omit<StatusBlockProps, "phoneAction"> | undefined {
  const { t } = useTranslation();

  if (activity.status === "OPEN") {
    return {
      tone: "waiting",
      icon: Route,
      lead: t("activities.state.onTheRoad"),
      follow: t("activities.detail.status.openFollow"),
      action: actions.close ?? undefined,
    };
  }

  if (activity.status === "CLOSED" && activity.completeness === "COMPLETE_WITH_EXCEPTIONS") {
    return {
      tone: "waiting",
      icon: TriangleAlert,
      lead: t("activities.detail.status.gaps", { count: activity.completenessCodes.length }),
      follow: t(actions.complete === null ? "activities.detail.status.gapsManager" : "activities.detail.status.gapsFollow"),
      notes: [
        {
          key: "codes",
          icon: TriangleAlert,
          body: (
            <ul className="flex flex-wrap gap-2">
              {activity.completenessCodes.map((code) => (
                <li key={code}>
                  <StatusBadge tone="warning" icon={null}>
                    {t(`warnings.${code}`)}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          ),
        },
      ],
      action: actions.complete ?? undefined,
    };
  }

  return undefined;
}

/**
 * The trip's Overview: four figures, then its facts in the groups of the sheet
 * that recorded it. A fact nobody recorded reads "Not recorded". No "Add":
 * the departure and arrival readings are the sheet's, and what a closed trip
 * misses is added by reopening it (the status block says so).
 */
export function TripOverview({
  activity,
  children,
}: {
  activity: ActivityDetail;
  /** Further sections (planned against actual). */
  children?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { start, end } = tripReadings(activity);
  const km = (reading: Reading | undefined) =>
    reading === undefined
      ? null
      : t("activities.detail.readingValue", {
          value: reading.value,
          unit: t(`activities.detail.readings.units.${reading.readingType}`),
        });

  const tiles: MetricTiles = [
    {
      label: t("activities.detail.overview.started"),
      value: activity.startedAt === null ? null : formatDateTime(activity.startedAt, locale),
    },
    {
      label: t("activities.detail.overview.ended"),
      value: activity.endedAt === null ? null : formatDateTime(activity.endedAt, locale),
    },
    {
      label: t("activities.detail.overview.distance"),
      value: activity.distanceKm === null ? null : t("activities.detail.km", { count: activity.distanceKm }),
    },
    {
      label: t("activities.detail.overview.legs"),
      value: String(activity.legCount),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <MetricStrip tiles={tiles} />

      <FactsSection title={t("activities.detail.sections.truckAndCrew")}>
        <Fact
          label={t("activities.detail.truck")}
          value={
            activity.segments.length === 0 ? null : (
              <span className="flex flex-col gap-1">
                {activity.segments.map((segment) => (
                  <span key={segment.id} className="flex flex-wrap items-center gap-2">
                    <Link
                      to="/assets/$assetId"
                      params={{ assetId: segment.assetId }}
                      className="tabular-nums underline decoration-foreground/25 underline-offset-[3px] hover:decoration-foreground"
                    >
                      {segment.assetCode}
                    </Link>
                    <span className="text-muted-foreground">{t(`activities.roles.${segment.role}`)}</span>
                  </span>
                ))}
              </span>
            )
          }
        />
        <Fact
          label={t("activities.detail.crew")}
          value={
            activity.crew.length === 0 ? null : (
              <span className="flex flex-col gap-1">
                {activity.crew.map((member) => (
                  <span key={member.personId}>
                    {member.displayName}
                    <span className="text-muted-foreground">
                      {" · "}
                      {t(`activities.crewRoles.${member.role}`)}
                    </span>
                  </span>
                ))}
              </span>
            )
          }
        />
        <Fact label={t("activities.detail.startKm")} value={km(start)} />
        <Fact label={t("activities.detail.endKm")} value={km(end)} />
      </FactsSection>

      <FactsSection title={t("activities.detail.sections.job")}>
        <Fact label={t("activities.detail.type")} value={localizedLabel(activity.activityType, locale)} />
        <Fact label={t("activities.detail.customer")} value={activity.customerName} />
        <Fact label={t("activities.detail.clientReferenceLabel")} value={activity.clientReference} />
        <Fact
          label={t("activities.detail.route")}
          value={
            activity.originName === null || activity.destinationName === null
              ? null
              : t("activities.detail.routeValue", { from: activity.originName, to: activity.destinationName })
          }
        />
        <Fact label={t("activities.detail.notes")} value={activity.description} wide />
      </FactsSection>

      {children}
    </div>
  );
}

/**
 * The context column's money box: profit or loss over the posted lines, the
 * revenue and the expenses behind it. A trip with no revenue says so rather
 * than showing a profit nobody earned.
 */
export function TripMoneyBox({ entries, onOpen }: { entries: readonly Entry[]; onOpen: () => void }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const net = postedNetMinor(entries);
  const { revenue, expenses, revenueLines } = postedTotals(entries);
  const money = (minor: number) => formatMoney(minor, { locale });

  return (
    <ContextBox
      title={t("activities.detail.moneyBox.title")}
      action={
        <button
          type="button"
          onClick={onOpen}
          className="relative text-sm font-medium text-primary underline-offset-4 after:absolute after:-inset-x-2 after:-inset-y-3 hover:underline"
        >
          {t("record.openTab")}
        </button>
      }
    >
      <dl>
        <ContextRow
          strong
          label={t("activities.detail.moneyBox.result", { sign: net < 0 ? "loss" : "profit" })}
          value={money(Math.abs(net))}
        />
        <ContextRow
          label={t("activities.detail.moneyBox.revenue")}
          value={revenueLines === 0 ? <NotRecorded /> : money(revenue)}
        />
        <ContextRow label={t("activities.detail.moneyBox.expenses")} value={money(expenses)} />
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">{t("activities.detail.moneySummary.postedOnly")}</p>
    </ContextBox>
  );
}

/** The trucks the trip ran on, each opening its workspace. */
export function TripLinked({ activity }: { activity: ActivityDetail }) {
  const { t } = useTranslation();
  const seen = new Set<string>();
  const assets = activity.segments.filter((segment) => {
    if (seen.has(segment.assetId)) return false;
    seen.add(segment.assetId);
    return true;
  });

  return (
    <ContextBox title={t("record.linked")}>
      {assets.length === 0 ? (
        <p className="text-muted-foreground">{t("activities.detail.notLinked")}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {assets.map((segment) => (
            <Link
              key={segment.assetId}
              to="/assets/$assetId"
              params={{ assetId: segment.assetId }}
              className="inline-flex min-h-11 items-center gap-2 underline decoration-foreground/25 underline-offset-[3px] hover:decoration-foreground"
            >
              <span className="tabular-nums">{segment.assetCode}</span>
              <span className="text-muted-foreground no-underline">{t(`activities.roles.${segment.role}`)}</span>
            </Link>
          ))}
        </div>
      )}
    </ContextBox>
  );
}
