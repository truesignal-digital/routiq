import { useTranslation } from "react-i18next";
import type { AssetReadingItem } from "@routiq/contracts";
import { Button } from "@/components/ui/button";
import { ReadingForm } from "@/activities/ReadingForm.js";
import { formatDateTime } from "@/lib/format.js";
import { cn } from "@/lib/utils";
import { useVehicle, type PanelForm } from "../context.js";
import type { RecordSteps } from "../flow.js";
import { DetailHeader } from "../parts.js";
import { useAssetReadings } from "../useVehicle.js";
import { PanelFooter, PanelLoading, PanelMissing, useFormHost } from "./shared.js";

/**
 * The change from the previous CURRENT reading of the same meter; superseded
 * readings are listed and flagged but never enter a delta.
 */
export function readingDeltas(items: readonly AssetReadingItem[]): Map<string, number> {
  const deltas = new Map<string, number>();
  const current = items.filter((item) => item.supersededById === null);
  for (let index = 0; index < current.length; index += 1) {
    const item = current[index];
    if (item === undefined) continue;
    const older = current.slice(index + 1).find((candidate) => candidate.readingType === item.readingType);
    if (older !== undefined) deltas.set(item.id, item.value - older.value);
  }
  return deltas;
}

export function ReadingsRecord({ form }: { form: PanelForm | undefined }) {
  const { gates } = useVehicle();
  if (!gates.trips) return <PanelMissing />;
  return <ReadingsBody form={form} />;
}

function ReadingsBody({ form }: { form: PanelForm | undefined }) {
  const { t, i18n } = useTranslation();
  const { asset, panel, can, pinnedLabel } = useVehicle();
  const query = useAssetReadings(asset.id, true);
  const host = useFormHost(t("vehicle.readings.title"));
  const locale = i18n.language;
  const last = asset.lastReading;

  if (form?.key === "record-reading") {
    return (
      <ReadingForm
        surface="panel"
        pinnedAssetId={asset.id}
        pinnedAssetLabel={pinnedLabel}
        lastReading={last === null ? undefined : { readingType: last.readingType, value: last.value }}
        back={host.back}
        onDone={host.onDone}
        onDismiss={host.onDismiss}
      />
    );
  }
  if (query.isPending) return <PanelLoading />;
  if (query.isError) return <PanelMissing onRetry={() => void query.refetch()} />;

  const items = query.data.pages.flatMap((page) => page.items);
  const deltas = readingDeltas(items);
  const steps: RecordSteps = {
    primary: { kind: "none" },
    offered: can("record-reading") ? [{ step: { key: "record-reading", record: { kind: "readings" } } }] : [],
  };

  return (
    <>
      <DetailHeader
        eyebrow={t("vehicle.readings.eyebrow")}
        title={
          last === null
            ? t("vehicle.facts.noReading")
            : t("vehicle.facts.readingValue", { readingType: last.readingType, value: last.value })
        }
        description={t("vehicle.readings.description")}
      />
      <div className="space-y-3 p-4">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("vehicle.readings.empty")}</p>
        ) : (
          <ol className="divide-y rounded-lg border">
            {items.map((reading) => {
              const delta = deltas.get(reading.id);
              const superseded = reading.supersededById !== null;
              return (
                <li key={reading.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className={cn("text-sm font-medium tabular-nums", superseded && "text-muted-foreground line-through")}>
                      {t("vehicle.facts.readingValue", { readingType: reading.readingType, value: reading.value })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("vehicle.readings.meta", {
                        source: t(`vehicle.readings.source.${reading.source}`),
                        name: reading.recordedBy.displayName ?? t("history.actor.unknown"),
                        date: formatDateTime(reading.observedAt, locale),
                      })}
                    </p>
                    {superseded && (
                      <p className="text-xs text-muted-foreground">
                        {reading.supersedeReason === null
                          ? t("vehicle.readings.superseded")
                          : t("vehicle.readings.supersededBecause", { reason: reading.supersedeReason })}
                      </p>
                    )}
                  </div>
                  {delta !== undefined && (
                    <span
                      className={cn(
                        "shrink-0 text-xs tabular-nums",
                        delta < 0 ? "font-medium text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {t("vehicle.readings.delta", { readingType: reading.readingType, delta })}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {query.hasNextPage && (
          <Button
            variant="outline"
            className="desktop:h-9"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {t("vehicle.history.loadMore")}
          </Button>
        )}
      </div>
      <PanelFooter steps={steps} onStep={panel.openStep} />
    </>
  );
}
