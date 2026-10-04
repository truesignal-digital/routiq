import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { ActivityDetail } from "@routiq/contracts";
import { useActivity } from "@/activities/useActivities.js";
import { RecordEntryForm } from "@/finance/RecordEntryForm.js";
import { formatDateTime, formatMoney, localizedLabel } from "@/lib/format.js";
import { useVehicle, type PanelForm } from "../context.js";
import type { RecordSteps } from "../flow.js";
import { DetailHeader, DetailSection, FactList, Note } from "../parts.js";
import { TripState } from "@/activities/TripState.js";
import { tripRoute } from "../tabs/TripsTab.js";
import { EntryStatusBadge, PanelFooter, PanelLoading, PanelMissing, useFormHost } from "./shared.js";

export function TripRecord({ id, form }: { id: string; form: PanelForm | undefined }) {
  const { gates } = useVehicle();
  if (!gates.trips) return <PanelMissing />;
  return <TripRecordBody id={id} form={form} />;
}

function TripRecordBody({ id, form }: { id: string; form: PanelForm | undefined }) {
  const { t, i18n } = useTranslation();
  const { asset, panel, gates, can, pinnedLabel, refresh } = useVehicle();
  const query = useActivity(id);
  const host = useFormHost(t("vehicle.panel.tripTitle"));
  const locale = i18n.language;

  if (query.isPending) return <PanelLoading />;
  if (query.isError || query.data === undefined) return <PanelMissing onRetry={() => void query.refetch()} />;
  const trip = query.data;
  const back = { ...host.back, label: t("vehicle.trips.tripNumber", { number: trip.activityNumber }) };

  if (form?.key === "add-cost") {
    return (
      <RecordEntryForm
        surface="panel"
        initialDirection="EXPENSE"
        lockDirection
        pinnedAssetId={asset.id}
        pinnedAssetLabel={pinnedLabel}
        link={{ activityId: trip.id }}
        defaultBranchCode={trip.branchCode}
        back={back}
        onRecorded={() => {
          void refresh();
          panel.closeForm();
        }}
        onDismiss={host.onDismiss}
      />
    );
  }

  const driver = trip.crew.find((member) => member.role === "DRIVER")?.displayName ?? trip.driverName;
  const readings = trip.readings.filter((reading) => reading.assetId === asset.id);
  const steps: RecordSteps = {
    primary: { kind: "none" },
    offered: can("record-expense") ? [{ step: { key: "add-cost", record: { kind: "trip", id: trip.id } } }] : [],
  };

  return (
    <>
      <DetailHeader
        eyebrow={t("vehicle.panel.tripEyebrow", {
          number: trip.activityNumber,
          type: localizedLabel(trip.activityType, locale),
        })}
        title={tripRoute(trip, t) ?? localizedLabel(trip.activityType, locale)}
        meta={<TripState trip={trip} />}
      />
      <div className="space-y-6 p-4">
        <FactList
          rows={[
            [t("vehicle.trips.customer"), trip.customerName ?? t("vehicle.trips.none")],
            [t("vehicle.trips.driver"), driver ?? t("vehicle.details.notRecorded")],
            [t("vehicle.trips.started"), trip.startedAt === null ? t("vehicle.details.notRecorded") : formatDateTime(trip.startedAt, locale)],
            [t("vehicle.trips.ended"), trip.endedAt === null ? "—" : formatDateTime(trip.endedAt, locale)],
            [
              t("vehicle.trips.distance"),
              trip.distanceKm === null ? t("vehicle.trips.distanceUnknown") : t("vehicle.trips.km", { value: trip.distanceKm }),
            ],
          ]}
        />
        {trip.completeness === "COMPLETE_WITH_EXCEPTIONS" && (
          <Note>{t("vehicle.trips.gapsNote", { count: trip.completenessCodes.length })}</Note>
        )}
        {gates.money && trip.financialEntries !== null && (
          <TripMoney entries={trip.financialEntries} />
        )}
        <DetailSection title={t("vehicle.trips.odometer")}>
          {readings.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("vehicle.trips.noReadings")}</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {readings.map((reading) => (
                <li key={reading.id} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">
                    {t("vehicle.trips.readingLine", {
                      source: t(`vehicle.readings.source.${reading.source}`),
                      date: formatDateTime(reading.observedAt, locale),
                    })}
                  </span>
                  <span className="font-medium tabular-nums">
                    {t("vehicle.facts.readingValue", { readingType: reading.readingType, value: reading.value })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DetailSection>
        <Link
          to="/activities/$activityId"
          params={{ activityId: trip.id }}
          className="inline-block text-sm font-medium underline decoration-foreground/25 underline-offset-[3px] hover:decoration-foreground"
        >
          {t("vehicle.trips.openFull")}
        </Link>
      </div>
      <PanelFooter steps={steps} onStep={panel.openStep} />
    </>
  );
}

/** The trip's own entries, whole amounts: a trip can carry costs for several vehicles. */
function TripMoney({ entries }: { entries: NonNullable<ActivityDetail["financialEntries"]> }) {
  const { t, i18n } = useTranslation();
  const { panel } = useVehicle();
  return (
    <DetailSection
      title={t("vehicle.trips.linkedMoney")}
      aside={entries.length > 0 ? t("vehicle.trips.wholeTrip") : undefined}
    >
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("vehicle.trips.noMoney")}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {entries.map((entry) => (
            <li key={entry.entryId}>
              <button
                type="button"
                onClick={() => panel.openRecord({ kind: "entry", id: entry.entryId })}
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted/50"
              >
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-sm font-medium tabular-nums">{entry.entryNumber}</span>
                  <EntryStatusBadge status={entry.status} />
                </span>
                <span className="shrink-0 text-sm tabular-nums">
                  {formatMoney(entry.amountMinor, {
                    locale: i18n.language,
                    ...(entry.direction === "REVENUE" ? { signDisplay: "exceptZero" as const } : {}),
                  })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </DetailSection>
  );
}
