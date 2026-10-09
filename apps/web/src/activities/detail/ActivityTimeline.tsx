import type { ActivityDetail } from "@routiq/contracts";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format.js";
import { cn } from "@/lib/utils.js";

export type ActivityTimelineData = Pick<
  ActivityDetail,
  "status" | "plannedStartAt" | "plannedEndAt" | "startedAt" | "endedAt"
>;

export interface TimelineBar {
  leftPct: number;
  widthPct: number;
}

/** A same-instant span would collapse to nothing; a bar nobody can see is a lie. */
const MIN_WIDTH_PCT = 2;

function stampOf(iso: string | null): number | null {
  if (iso === null) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

/**
 * Places one span on the shared scale. `end === null` means the span has no
 * recorded end — it runs to the edge of everything else we know about.
 */
export function timelineBar(
  start: number | null,
  end: number | null,
  scale: { min: number; max: number },
): TimelineBar | null {
  if (start === null) return null;
  const span = scale.max - scale.min || 1;
  const finish = Math.max(end ?? scale.max, start);
  const rawLeft = ((start - scale.min) / span) * 100;
  const rawWidth = ((finish - start) / span) * 100;
  const widthPct = Math.min(100, Math.max(rawWidth, MIN_WIDTH_PCT));
  const leftPct = Math.max(0, Math.min(rawLeft, 100 - widthPct));
  return { leftPct, widthPct };
}

interface TrackProps {
  bar: TimelineBar | null;
  variant: "planned" | "actual";
  running: boolean;
}

function Track({ bar, variant, running }: TrackProps) {
  return (
    <div
      className="h-2.5 w-full overflow-hidden rounded-full bg-foreground/[0.06]"
      aria-hidden
    >
      {bar !== null && (
        <div
          className={cn(
            "h-full rounded-full",
            variant === "planned" ? "bg-foreground/25" : "bg-primary",
            // Movement is a nicety, never the signal: the label already says
            // "still running" for anyone who has motion turned off.
            running && "bg-primary/70 motion-safe:animate-pulse",
          )}
          style={{ marginInlineStart: `${bar.leftPct}%`, width: `${bar.widthPct}%` }}
        />
      )}
    </div>
  );
}

export interface ActivityTimelineProps {
  activity: ActivityTimelineData;
}

/**
 * Planned against actual, as two bars on one scale. No chart library: the
 * comparison is one division, and a low-end Android should not download a
 * plotting runtime to see it.
 */
export function ActivityTimeline({ activity }: ActivityTimelineProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  const plannedStart = stampOf(activity.plannedStartAt);
  const plannedEnd = stampOf(activity.plannedEndAt);
  if (plannedStart === null && plannedEnd === null) return null;

  const actualStart = stampOf(activity.startedAt);
  const actualEnd = stampOf(activity.endedAt);
  const stamps = [plannedStart, plannedEnd, actualStart, actualEnd].filter(
    (stamp): stamp is number => stamp !== null,
  );
  const scale = { min: Math.min(...stamps), max: Math.max(...stamps) };

  const running = activity.startedAt !== null && activity.endedAt === null;
  const plannedBar = timelineBar(plannedStart, plannedEnd, scale);
  const actualBar = timelineBar(actualStart, actualEnd, scale);

  /** Either end can be missing on its own — say which one we have, not "nothing". */
  function spanLabel(from: string | null, to: string | null, isRunning: boolean): string {
    if (from === null && to === null) return t("activities.detail.timeline.notRecorded");
    const left = from === null ? "…" : formatDateTime(from, locale);
    const right =
      to === null
        ? isRunning
          ? "—"
          : t("activities.detail.timeline.openEnd")
        : formatDateTime(to, locale);
    return `${left} → ${right}`;
  }

  const rows = [
    {
      key: "planned",
      label: t("activities.detail.timeline.planned"),
      bar: plannedBar,
      variant: "planned" as const,
      running: false,
      from: activity.plannedStartAt,
      to: activity.plannedEndAt,
    },
    {
      key: "actual",
      label: t("activities.detail.timeline.actual"),
      bar: actualBar,
      variant: "actual" as const,
      running,
      from: activity.startedAt,
      to: activity.endedAt,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("activities.detail.timeline.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {rows.map((row) => (
          <div key={row.key} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-muted-foreground text-xs">
                {row.label}
              </span>
              <span className="text-sm tabular-nums">
                {spanLabel(row.from, row.to, row.running)}
              </span>
            </div>
            <Track bar={row.bar} variant={row.variant} running={row.running} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
