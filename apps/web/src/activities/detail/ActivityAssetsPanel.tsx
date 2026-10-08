import type { ActivityDetail } from "@routiq/contracts";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/status-badge.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatDateTime } from "@/lib/format.js";

type Reading = ActivityDetail["readings"][number];

export type ActivityAssetsPanelData = Pick<
  ActivityDetail,
  "segments" | "crew" | "readings"
>;

export interface ReadingSpan {
  readingType: Reading["readingType"];
  from: Reading;
  to: Reading | null;
}

/**
 * One span per meter: the earliest live reading and the latest, which is what a
 * clerk checking distance travelled actually wants to compare. Superseded rows
 * stay out of the span but never leave the record (§3.4 append-only).
 */
export function readingSpans(readings: readonly Reading[]): ReadingSpan[] {
  const live = readings.filter((reading) => reading.supersededById === null);
  const types = [...new Set(live.map((reading) => reading.readingType))];

  return types.flatMap((readingType) => {
    const ordered = live
      .filter((reading) => reading.readingType === readingType)
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    const [from] = ordered;
    if (from === undefined) return [];
    const last = ordered[ordered.length - 1];
    return [{ readingType, from, to: ordered.length > 1 && last ? last : null }];
  });
}

function ReadingValue({
  reading,
  unit,
  locale,
}: {
  reading: Reading;
  unit: string;
  locale: string;
}) {
  return (
    <span className="tabular-nums">
      {new Intl.NumberFormat(locale).format(reading.value)} {unit}
    </span>
  );
}

export interface ActivityAssetsPanelProps {
  activity: ActivityAssetsPanelData;
}

export function ActivityAssetsPanel({ activity }: ActivityAssetsPanelProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { segments, crew, readings } = activity;

  if (segments.length === 0 && crew.length === 0 && readings.length === 0) return null;

  const spans = readingSpans(readings);
  const superseded = readings.filter((reading) => reading.supersededById !== null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("activities.detail.assets")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {segments.map((segment) => (
          <div key={segment.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="tabular-nums">{segment.assetCode}</span>
            <StatusBadge tone={segment.role === "SUBSTITUTE" ? "warning" : "neutral"}>
              {t(`activities.roles.${segment.role}`)}
            </StatusBadge>
            <span className="text-muted-foreground">
              {formatDateTime(segment.startedAt, locale)}
              {" → "}
              {segment.endedAt === null ? "—" : formatDateTime(segment.endedAt, locale)}
            </span>
          </div>
        ))}

        {crew.length > 0 && (
          <>
            {segments.length > 0 && <Separator />}
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {crew.map((member) => (
                <span key={member.personId} className="text-sm">
                  {member.displayName}
                  <span className="text-muted-foreground">
                    {" · "}
                    {t(`activities.crewRoles.${member.role}`)}
                  </span>
                </span>
              ))}
            </div>
          </>
        )}

        {readings.length > 0 && (
          <>
            {(segments.length > 0 || crew.length > 0) && <Separator />}
            <div className="flex flex-col gap-2">
              <h3 className="text-muted-foreground text-xs">
                {t("activities.detail.readings.title")}
              </h3>

              {spans.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("activities.detail.readings.allSuperseded")}
                </p>
              ) : (
                <dl className="flex flex-col gap-1.5">
                  {spans.map((span) => {
                    const unit = t(
                      `activities.detail.readings.units.${span.readingType}`,
                    );
                    return (
                      <div
                        key={span.readingType}
                        className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                      >
                        <dt className="text-muted-foreground">
                          {t(`activities.record.readings.types.${span.readingType}`)}
                        </dt>
                        <dd className="flex flex-wrap items-baseline gap-1.5">
                          <ReadingValue
                            reading={span.from}
                            unit={unit}
                            locale={locale}
                          />
                          {span.to !== null && (
                            <>
                              <span aria-hidden>→</span>
                              <ReadingValue
                                reading={span.to}
                                unit={unit}
                                locale={locale}
                              />
                              <span className="text-muted-foreground tabular-nums">
                                {t("activities.detail.readings.delta", {
                                  value: new Intl.NumberFormat(locale, {
                                    signDisplay: "exceptZero",
                                  }).format(span.to.value - span.from.value),
                                  unit,
                                })}
                              </span>
                            </>
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              )}

              {superseded.length > 0 && (
                // A correction that hid what it replaced would be an edit. The
                // chain is folded away, never dropped.
                <details className="rounded-lg bg-foreground/[0.03] px-3 py-2">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center text-xs text-muted-foreground">
                    {t("activities.detail.readings.corrected", {
                      count: superseded.length,
                    })}
                  </summary>
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {superseded
                      .slice()
                      .sort((a, b) => a.observedAt.localeCompare(b.observedAt))
                      .map((reading) => (
                        <li
                          key={`${reading.readingType}-${reading.observedAt}-${reading.value}`}
                          className="flex flex-wrap items-baseline gap-2 text-xs text-muted-foreground line-through decoration-muted-foreground/50"
                        >
                          <span>
                            {t(`activities.record.readings.types.${reading.readingType}`)}
                          </span>
                          <ReadingValue
                            reading={reading}
                            unit={t(
                              `activities.detail.readings.units.${reading.readingType}`,
                            )}
                            locale={locale}
                          />
                          <span>{formatDateTime(reading.observedAt, locale)}</span>
                          <span>
                            {t(`activities.detail.readings.sources.${reading.source}`)}
                          </span>
                        </li>
                      ))}
                  </ul>
                </details>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
